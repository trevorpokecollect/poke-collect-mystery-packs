import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LogMailer } from "../email/mailer.server";
import { sendEmail, sendPendingEmails, shipmentNotifier } from "../email/outbox.server";
import {
  buyLabel,
  fixShipmentCard,
  cancelShipment,
  createShipment,
  handleEasyPostWebhook,
  handleTrackingWebhook,
  markShipped,
  shippingQueue,
  type ShippingDeps,
} from "./service.server";
import type { Address, Label, Rate, ShippingProvider, Tracking } from "./shippo.server";
import { sqlCopyStore } from "./sql-copy-store";
import { priceKey } from "../core/stock.server";
import { deskAction, loadDesk } from "./desk.server";
import { FeePaymentError, type FeePayer, type Tx } from "./types";
import type { Parcel } from "./policy";
import { brokerShippingAction } from "./broker-api.server";
import { SHIP_SETTINGS_KEY } from "./packages.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });

class FakeShippo implements ShippingProvider {
  labels = 0;
  validCalls = 0;
  tracking: Record<string, Tracking> = {};
  invalid = false;
  carrierState: string | null = null;
  async validateAddress(a: Address) {
    this.validCalls++;
    return { valid: !this.invalid, address: { ...a, street1: a.street1.toUpperCase(), ...(this.carrierState ? { state: this.carrierState } : {}) }, residential: true, messages: this.invalid ? ["Address not found"] : [] };
  }
  lastParcel: Parcel | null = null;
  async rates(_from: Address, _to: Address, parcel: Parcel): Promise<Rate[]> {
    this.lastParcel = parcel;
    return [
      { rateId: "r_pri", shipmentId: "s1", carrier: "USPS", service: "Priority Mail", serviceToken: "usps_priority", amountCents: 910, currency: "USD", days: 2, attributes: [] },
      { rateId: "r_ga", shipmentId: "s1", carrier: "USPS", service: "Ground Advantage", serviceToken: "usps_ground_advantage", amountCents: 495, currency: "USD", days: 4, attributes: [] },
    ];
  }
  boughtOn: (string | undefined)[] = [];
  async buyLabel(rateId: string, _meta: string, shipmentId?: string): Promise<Label> {
    this.labels++;
    this.boughtOn.push(shipmentId);
    await new Promise((r) => setTimeout(r, 30));
    return { transactionId: `tx_${this.labels}`, status: "SUCCESS", trackingNumber: `9400${this.labels}`, trackingUrl: "https://track.test", labelUrl: "https://label.test", messages: [rateId] };
  }
  async track(carrier: string, n: string): Promise<Tracking> {
    return this.tracking[n] ?? { carrier, trackingNumber: n, status: "UNKNOWN", detail: "", at: null, eta: null };
  }
}

// Wallet stand-in with the same idempotency contract the lead's ledger must honor.
function memoryFees(balances: Map<string, number>): FeePayer & { keys: Set<string> } {
  const keys = new Set<string>();
  return {
    keys,
    async debitBits(_tx: Tx, customer, bits, key) {
      if (keys.has(key)) return { ledgerId: key };
      const bal = balances.get(customer) ?? 0;
      if (bal < bits) throw new FeePaymentError("Not enough Cardbits.", "INSUFFICIENT_BITS");
      balances.set(customer, bal - bits);
      keys.add(key);
      return { ledgerId: key };
    },
    async refundBits(_tx: Tx, customer, bits, key) {
      if (keys.has(key)) return { ledgerId: key };
      balances.set(customer, (balances.get(customer) ?? 0) + bits);
      keys.add(key);
      return { ledgerId: key };
    },
  };
}

const from: Address = { name: "Cardbit", street1: "100 Test Way", city: "Austin", state: "TX", zip: "78701", country: "US" };
const toAddr: Address = { name: "Ash K", street1: "1 Main St", city: "Dallas", state: "TX", zip: "75201", country: "US" };

describe.skipIf(!url)("site shipping (integration)", () => {
  let shippo: FakeShippo;
  let balances: Map<string, number>;
  let mailer: LogMailer;
  let deps: ShippingDeps;

  beforeAll(async () => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  beforeEach(async () => {
    await db.siteShipment.deleteMany();
    await db.siteShipPackage.deleteMany();
    await db.appValue.deleteMany({ where: { key: SHIP_SETTINGS_KEY } });
    await db.siteEmail.deleteMany();
    await db.siteCopyEvent.deleteMany();
    await db.siteRestock.deleteMany();
    await db.siteCopy.deleteMany();
    const copy = (id: string, status: string, owner: string | null, slot: number | null, pocket: number | null, printing: string) =>
      db.siteCopy.create({
        data: {
          id, receiptKey: `rk-${id}`, printingKey: printing, title: `Card ${id}`, game: "pokemon", setName: "Test",
          number: id, name: `Card ${id}`, finish: "normal", language: "en", condition: "NM",
          image: `https://img.test/${id}.webp`, slot, pocket, lookKey: `look-${id}`, faceKey: `face-${id}`,
          status, ownerId: owner,
        },
      });
    for (let i = 1; i <= 40; i++)
      await copy(`c${i}`, "VAULTED", i <= 35 ? "u1" : "u2", 10000 + Math.ceil(i / 20), ((i - 1) % 20) + 1, `p${i}`);
    // Spares for Fix Card: two filed for-sale copies of c1's printing, one unfiled (not eligible).
    await copy("spare-a", "FOR_SALE", null, 10005, 2, "p1");
    await copy("spare-b", "FOR_SALE", null, 10005, 1, "p1");
    await copy("spare-unfiled", "FOR_SALE", null, null, null, "p1");
    shippo = new FakeShippo();
    balances = new Map([["u1", 1000], ["u2", 100]]);
    mailer = new LogMailer();
    deps = {
      db,
      copies: sqlCopyStore(),
      fees: memoryFees(balances),
      provider: shippo,
      notify: shipmentNotifier({ db, mailer, env: {} }),
      from,
      now: () => new Date("2026-11-25T12:00:00Z"),
    };
  });

  const statusOf = async (id: string) => (await db.siteCopy.findUniqueOrThrow({ where: { id } })).status;
  const base = (over: Partial<Parameters<typeof createShipment>[1]> = {}) => ({
    customerId: "u1",
    customerEmail: "ash@example.com",
    copyIds: ["c1", "c2"],
    address: toAddr,
    billing: { country: "US", state: "TX" },
    ip: null,
    method: "CARDBITS" as const,
    idempotencyKey: "click-1",
    ...over,
  });

  it("locks copies, takes 600 Cardbits, validates the address, emails once, and replays", async () => {
    const { shipment, replay } = await createShipment(deps, base());
    expect(replay).toBe(false);
    expect(shipment).toMatchObject({ status: "PAID", feeKind: "CARDBITS", feeBits: 600, cardCount: 2, addressValidated: true });
    expect((shipment.toAddress as Address).street1).toBe("1 MAIN ST");
    expect(shipment.processBy.toISOString()).toBe("2026-11-27T12:00:00.000Z");
    expect(await statusOf("c1")).toBe("SHIP_LOCKED");
    expect(balances.get("u1")).toBe(400);
    const again = await createShipment(deps, base());
    expect(again).toMatchObject({ replay: true });
    expect(again.shipment.id).toBe(shipment.id);
    expect(balances.get("u1")).toBe(400);
    expect(mailer.sent.map((m) => m.subject)).toEqual(["Shipment Requested: 2 Cards"]);
  });

  it("ships 30 or more cards free", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `c${i + 1}`);
    const { shipment } = await createShipment(deps, base({ copyIds: ids }));
    expect(shipment).toMatchObject({ feeKind: "FREE", feeBits: 0 });
    expect(balances.get("u1")).toBe(1000);
  });

  it("ships free at 10,000 Cardbits of card value (copy retail, else Card Broker retail, else buyback)", async () => {
    await db.sitePrice.deleteMany({ where: { printingKey: { in: [priceKey("p1", "NM"), priceKey("p2", "NM")] } } });
    await db.siteCopy.update({ where: { id: "c1" }, data: { retailBits: 6000 } });
    await db.sitePrice.create({ data: { printingKey: priceKey("p2", "NM"), buybackBits: 3999 } });
    const short = await createShipment(deps, base({ idempotencyKey: "v-1" }));
    expect(short.shipment).toMatchObject({ feeKind: "CARDBITS", feeBits: 600 });
    await cancelShipment(deps, short.shipment.id, "staff:t", "value test");
    await db.sitePrice.update({ where: { printingKey: priceKey("p2", "NM") }, data: { buybackBits: 4000 } });
    const { shipment } = await createShipment(deps, base({ idempotencyKey: "v-2" }));
    expect(shipment).toMatchObject({ feeKind: "FREE", feeBits: 0 });
    await db.sitePrice.deleteMany({ where: { printingKey: priceKey("p2", "NM") } });
  });

  it("rejects the whole selection if one copy isn't the customer's vaulted copy, leaving nothing behind", async () => {
    await expect(createShipment(deps, base({ copyIds: ["c1", "c36"] }))).rejects.toMatchObject({ name: "CopyLockError", unavailable: ["c36"] });
    expect(await statusOf("c1")).toBe("VAULTED");
    expect(await db.siteShipment.count()).toBe(0);
    expect(balances.get("u1")).toBe(1000);
  });

  it("rolls back the lock when the customer can't cover the fee", async () => {
    await expect(createShipment(deps, base({ customerId: "u2", copyIds: ["c36"] }))).rejects.toMatchObject({ code: "INSUFFICIENT_BITS" });
    expect(await statusOf("c36")).toBe("VAULTED");
    expect(await db.siteShipment.count()).toBe(0);
  });

  it("gives the last copy to exactly one of two simultaneous requests", async () => {
    const results = await Promise.allSettled([
      createShipment(deps, base({ copyIds: ["c5"], idempotencyKey: "a" })),
      createShipment(deps, base({ copyIds: ["c5", "c6"], idempotencyKey: "b" })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.siteShipment.count()).toBe(1);
  });

  it("blocks excluded states and bad carrier addresses before touching copies", async () => {
    await expect(createShipment(deps, base({ address: { ...toAddr, state: "NY" } }))).rejects.toMatchObject({ code: "EXCLUDED_STATE" });
    await expect(createShipment(deps, base({ billing: { country: "US", state: "UT" } }))).rejects.toMatchObject({ code: "EXCLUDED_STATE" });
    shippo.invalid = true;
    await expect(createShipment(deps, base())).rejects.toMatchObject({ code: "ADDRESS_INVALID", details: ["Address not found"] });
    expect(await statusOf("c1")).toBe("VAULTED");
  });

  it("refuses USD fees until card payments are enabled", async () => {
    await expect(createShipment(deps, base({ method: "USD", paymentRef: "pay_1" }))).rejects.toMatchObject({ code: "USD_DISABLED" });
  });

  it("cancels before a label: copies back to the vault, fee refunded once", async () => {
    const { shipment } = await createShipment(deps, base());
    await cancelShipment(deps, shipment.id, "staff:t", "customer asked");
    await cancelShipment(deps, shipment.id, "staff:t", "double click");
    expect(await statusOf("c1")).toBe("VAULTED");
    expect(balances.get("u1")).toBe(1000);
  });

  it("buys exactly one label when staff double-click, picks Ground Advantage, then can't cancel", async () => {
    const { shipment } = await createShipment(deps, base());
    const results = await Promise.allSettled([buyLabel(deps, shipment.id, "staff:a"), buyLabel(deps, shipment.id, "staff:b")]);
    expect(shippo.labels).toBe(1);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    const s = await db.siteShipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(s).toMatchObject({ status: "LABEL_PURCHASED", service: "Ground Advantage", postageCents: 495, trackingNumber: "94001" });
    await expect(cancelShipment(deps, shipment.id, "staff:a", "x")).rejects.toMatchObject({ code: "WRONG_STATE" });
  });

  it("follows tracking webhooks: re-reads Shippo, dedupes, ignores stale events, emails once each", async () => {
    const { shipment } = await createShipment(deps, base());
    await buyLabel(deps, shipment.id, "staff:a");
    const hook = { event: "track_updated", data: { tracking_number: "94001", carrier: "usps", tracking_status: { status: "DELIVERED" } } };

    // Body says DELIVERED, Shippo says PRE_TRANSIT: nothing changes.
    expect(await handleTrackingWebhook(deps, hook)).toMatchObject({ ignored: "pre_transit" });

    shippo.tracking["94001"] = { carrier: "usps", trackingNumber: "94001", status: "TRANSIT", detail: "Accepted", at: "2026-11-26T15:00:00Z", eta: null };
    await handleTrackingWebhook(deps, hook);
    await handleTrackingWebhook(deps, hook); // duplicate delivery
    expect(await statusOf("c1")).toBe("SHIPPED");

    shippo.tracking["94001"] = { carrier: "usps", trackingNumber: "94001", status: "DELIVERED", detail: "Front door", at: "2026-11-28T18:00:00Z", eta: null };
    expect(await handleTrackingWebhook(deps, hook)).toMatchObject({ status: "DELIVERED" });

    shippo.tracking["94001"] = { carrier: "usps", trackingNumber: "94001", status: "TRANSIT", detail: "late scan", at: "2026-11-27T01:00:00Z", eta: null };
    expect(await handleTrackingWebhook(deps, hook)).toMatchObject({ status: "DELIVERED" });

    expect(await handleTrackingWebhook(deps, { event: "track_updated", data: { tracking_number: "nope" } })).toMatchObject({ ignored: "unknown_number" });
    expect(mailer.sent.map((m) => m.subject)).toEqual([
      "Shipment Requested: 2 Cards",
      "Your Cards Have Shipped",
      "Your Cards Were Delivered",
    ]);
  });

  it("EasyPost path: buys on the rate's shipment and follows tracker.updated webhooks", async () => {
    const { shipment } = await createShipment(deps, base());
    await buyLabel(deps, shipment.id, "staff:a");
    expect(shippo.boughtOn).toEqual([expect.any(String)]);
    const ev = await db.siteShipmentEvent.findFirstOrThrow({ where: { shipmentId: shipment.id, kind: "label_purchased" } });
    expect(ev.detail).toMatchObject({ carrier: expect.any(String) });
    const hook = { object: "Event", description: "tracker.updated", result: { object: "Tracker", tracking_code: "94001", carrier: "USPS", status: "delivered" } };
    expect(await handleEasyPostWebhook(deps, { description: "batch.updated", result: {} })).toMatchObject({ ignored: "event" });
    expect(await handleEasyPostWebhook(deps, hook)).toMatchObject({ ignored: "pre_transit" }); // re-read says not moving yet
    shippo.tracking["94001"] = { carrier: "usps", trackingNumber: "94001", status: "DELIVERED", detail: "Mailbox", at: "2026-11-28T18:00:00Z", eta: null };
    expect(await handleEasyPostWebhook(deps, hook)).toMatchObject({ status: "DELIVERED" });
    const last = await db.siteShipmentEvent.findFirstOrThrow({ where: { shipmentId: shipment.id, kind: "status" }, orderBy: { createdAt: "desc" } });
    expect(last.actor).toBe("easypost");
    expect(await statusOf("c1")).toBe("SHIPPED");
  });

  it("Fix Card swap: replacement becomes the customer's locked copy, old copy goes back to stock unfiled", async () => {
    const { shipment } = await createShipment(deps, base());
    const fixed = await fixShipmentCard(deps, shipment.id, { action: "swap", copyId: "c1", revision: shipment.updatedAt.toISOString() }, "staff:a");
    expect(fixed.items.map((i) => i.copyId).sort()).toEqual(["c2", "spare-b"]);
    expect(fixed.items.find((i) => i.copyId === "spare-b")).toMatchObject({ slot: 10005, pocket: 1, image: "https://img.test/spare-b.webp" });
    const old = await db.siteCopy.findUniqueOrThrow({ where: { id: "c1" } });
    expect(old).toMatchObject({ status: "DRAFT", ownerId: null, orderId: null, slot: null, pocket: null });
    expect(await db.siteCopy.findUniqueOrThrow({ where: { id: "spare-b" } })).toMatchObject({ status: "SHIP_LOCKED", ownerId: "u1", orderId: shipment.id });
    expect(await db.siteCopyEvent.count({ where: { copyId: { in: ["c1", "spare-b"] } } })).toBeGreaterThanOrEqual(3);
    // Stale revision from the desk is refused.
    await expect(fixShipmentCard(deps, shipment.id, { action: "swap", copyId: "c2", revision: shipment.updatedAt.toISOString() }, "staff:a")).rejects.toMatchObject({ code: "WRONG_STATE" });
    // Next swap of the same printing takes the other filed spare, never the unfiled one, then runs out.
    await fixShipmentCard(deps, shipment.id, { action: "swap", copyId: "spare-b" }, "staff:a");
    await expect(fixShipmentCard(deps, shipment.id, { action: "swap", copyId: "spare-a" }, "staff:a")).rejects.toMatchObject({ name: "CopyLockError" });
    expect(await db.siteCopy.findUniqueOrThrow({ where: { id: "spare-unfiled" } })).toMatchObject({ status: "FOR_SALE" });
  });

  it("Fix Card remove: card returns to the customer's vault, last card can't be removed, no fixes after label", async () => {
    const { shipment } = await createShipment(deps, base());
    const fixed = await fixShipmentCard(deps, shipment.id, { action: "remove", copyId: "c1" }, "staff:a");
    expect(fixed).toMatchObject({ cardCount: 1, feeBits: 600 });
    expect(await db.siteCopy.findUniqueOrThrow({ where: { id: "c1" } })).toMatchObject({ status: "VAULTED", ownerId: "u1", orderId: null, slot: 10001 });
    await expect(fixShipmentCard(deps, shipment.id, { action: "remove", copyId: "c2" }, "staff:a")).rejects.toMatchObject({ code: "WRONG_STATE" });
    await buyLabel(deps, shipment.id, "staff:a");
    await expect(fixShipmentCard(deps, shipment.id, { action: "swap", copyId: "c2" }, "staff:a")).rejects.toMatchObject({ code: "WRONG_STATE" });
  });

  it("Fix Card and Buy Label at the same moment: one wins cleanly", async () => {
    const { shipment } = await createShipment(deps, base());
    await Promise.allSettled([
      buyLabel(deps, shipment.id, "staff:a"),
      fixShipmentCard(deps, shipment.id, { action: "swap", copyId: "c1" }, "staff:b"),
    ]);
    const s = await db.siteShipment.findUniqueOrThrow({ where: { id: shipment.id }, include: { items: true } });
    const locked = await db.siteCopy.findMany({ where: { orderId: shipment.id, status: "SHIP_LOCKED" } });
    expect(locked.map((c) => c.id).sort()).toEqual(s.items.map((i) => i.copyId).sort());
    expect(shippo.labels).toBeLessThanOrEqual(1);
  });

  it("desk: form posts swap, buy label and report errors back to the page", async () => {
    const { shipment } = await createShipment(deps, base());
    const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
    let to = await deskAction(deps, form({ intent: "swap", shipmentId: shipment.id, copyId: "c1" }), "staff:t");
    expect(to).toContain("msg=");
    to = await deskAction(deps, form({ intent: "remove", shipmentId: shipment.id, copyId: "nope" }), "staff:t");
    expect(new URL(to, "https://x").searchParams.get("err")).toContain("no longer on this shipment");
    to = await deskAction(deps, form({ intent: "label", shipmentId: shipment.id }), "staff:t");
    expect(new URL(to, "https://x").searchParams.get("msg")).toContain("Label bought: USPS 9400");
    const view = await loadDesk(deps, new URL(`https://site.test/staff/shipping?id=${shipment.id}`));
    expect(view.selected?.status).toBe("LABEL_PURCHASED");
  });

  it("says when the ZIP code belongs to another state, and lets staff test from an excluded-state connection", async () => {
    shippo.carrierState = "AL"; // e.g. state changed to FL but ZIP 35758 left in place
    await expect(createShipment(deps, base({ address: { ...toAddr, state: "FL", zip: "35758" } }))).rejects.toThrow("That ZIP code is in AL, not FL.");
    expect(await statusOf("c1")).toBe("VAULTED");
    shippo.carrierState = null;
    const geoDeps = { ...deps, geo: async () => ({ country: "US", region: "AL" }) };
    await expect(createShipment(geoDeps, base({ ip: "8.8.8.8" }))).rejects.toThrow(/internet connection looks like it's in AL/);
    const { shipment } = await createShipment(geoDeps, base({ ip: "8.8.8.8", staffTest: true, idempotencyKey: "staff-1" }));
    expect(shipment.status).not.toBe("FAILED");
  });

  it("desk system check: ship-from + rates, test email; billing defaults to the delivery address", async () => {
    const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
    let to = await deskAction(deps, form({ intent: "selftest-address" }), "staff:t");
    expect(new URL(to, "https://x").searchParams.get("msg")).toContain("Ground Advantage");
    to = await deskAction(deps, form({ intent: "selftest-email", to: "staff@example.com" }), "staff:t", { db, mailer, env: {} });
    expect(new URL(to, "https://x").searchParams.get("msg")).toContain("Test email sent");
    const { shipment } = await createShipment(deps, base({ billing: null, idempotencyKey: "nobill" }));
    expect(shipment.status).toBe("PAID");
    await expect(createShipment(deps, base({ billing: null, address: { ...toAddr, state: "WA" }, idempotencyKey: "wa" }))).rejects.toMatchObject({ code: "EXCLUDED_STATE" });
  });

  it("lists overdue paid shipments for staff", async () => {
    const { shipment } = await createShipment(deps, base());
    const q = await shippingQueue(db, new Date("2026-11-28T00:00:00Z"));
    expect(q.find((r) => r.id === shipment.id)?.overdue).toBe(true);
    await buyLabel(deps, shipment.id, "staff:a");
    await markShipped(deps, shipment.id, "staff:a");
    expect((await shippingQueue(db)).some((r) => r.id === shipment.id)).toBe(false);
  });

  it("outbox: one send per dedupe key, sign-in codes never stored, failures retried", async () => {
    await sendEmail({ db, mailer, env: {} }, "signin_code", "Ash@Example.com", { code: "123456", minutes: 10 }, "otp-1");
    await sendEmail({ db, mailer, env: {} }, "signin_code", "ash@example.com", { code: "123456", minutes: 10 }, "otp-1");
    expect(mailer.sent).toHaveLength(1);
    const row = await db.siteEmail.findFirstOrThrow({ where: { kind: "signin_code" } });
    expect(JSON.stringify(row.payload)).not.toContain("123456");
    expect(row.to).toBe("ash@example.com");

    let fail = true;
    const flaky = { live: true, async send() { if (fail) throw new Error("timeout"); return { id: "em_9" }; } };
    const r1 = await sendEmail({ db, mailer: flaky, env: {} }, "buyback_confirmation", "ash@example.com", { cards: [{ title: "X", bits: 100 }], totalBits: 100, balanceBits: 200 }, "bb-1");
    expect(r1.status).toBe("FAILED");
    fail = false;
    const later = new Date(Date.now() + 5 * 60_000);
    expect(await sendPendingEmails({ db, mailer: flaky, env: {} }, later)).toMatchObject({ sent: 1 });
    expect((await db.siteEmail.findUniqueOrThrow({ where: { id: r1.id } })).status).toBe("SENT");
  });

  it("Card Broker desk: packages, weight, all rates with cheapest pre-selected, label with chosen package", async () => {
    const act = (b: Record<string, unknown>) => brokerShippingAction(deps, b, "cardbroker:emily@poke-collect.com");
    const { shipment } = await createShipment(deps, base({ copyIds: ["c1", "c2", "c3"] }));

    // No saved packages yet: built-in sizes still quote.
    const d0 = await act({ intent: "detail", id: shipment.id, rates: true });
    expect(d0).toMatchObject({ packages: [], plan: { packageId: null, auto: true } });

    const saved = await act({ intent: "package-save", package: { name: "Small Mailer", kind: "mailer", lengthIn: 7.5, widthIn: 5.5, heightIn: 0.5, weightOz: 0.4, maxCards: 8 } });
    expect(saved).toMatchObject({ ok: true, packages: [{ name: "Small Mailer", kind: "MAILER", isDefault: true }] }); // first one is default
    await act({ intent: "package-save", package: { name: "Box", kind: "BOX", lengthIn: 8, widthIn: 6, heightIn: 4, weightOz: 3.2, maxCards: 120 } });
    await act({ intent: "settings-save", ozPerCard: 0.3, packingOz: 0.2 });
    await expect(act({ intent: "package-save", package: { name: "", lengthIn: 1, widthIn: 1, heightIn: 1, weightOz: 1 } })).rejects.toMatchObject({ status: 422 });

    const d1 = (await act({ intent: "detail", id: shipment.id, rates: true })) as Record<string, any>;
    // 3 cards fit the small mailer: 0.4 + 3 × 0.3 + 0.2 = 1.5 oz.
    expect(d1.plan).toMatchObject({ packageName: "Small Mailer", auto: true, weight: { totalOz: 1.5, cardsOz: 0.9 } });
    expect(d1.rates.map((r: { cents: number }) => r.cents)).toEqual([495, 910]); // cheapest first
    expect(d1.suggested).toBe("r_ga");
    expect(shippo.lastParcel).toMatchObject({ length: 7.5, weightOz: 1.5 });

    // Staff choose the box and a scale weight; rates re-quote with that parcel.
    const box = d1.packages.find((p: { name: string }) => p.name === "Box");
    const d2 = (await act({ intent: "detail", id: shipment.id, rates: true, packageId: box.id, weightOz: 4.04 })) as Record<string, any>;
    expect(d2.plan).toMatchObject({ packageId: box.id, auto: false, weight: { calculatedOz: 4.3, overrideOz: 4.04, totalOz: 4.1 } });
    expect(shippo.lastParcel).toMatchObject({ length: 8, height: 4, weightOz: 4.1 });

    const bought = (await act({ intent: "label", id: shipment.id, rateId: "r_pri", service: "usps_priority", packageId: box.id, weightOz: 4.04 })) as Record<string, any>;
    expect(bought.shipment).toMatchObject({ status: "LABEL_PURCHASED", postageCents: 910, canMarkShipped: true });
    const row = await db.siteShipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(row).toMatchObject({ packageId: box.id, weightOz: 4.1 });
    const ev = await db.siteShipmentEvent.findFirstOrThrow({ where: { shipmentId: shipment.id, kind: "label_purchased" } });
    expect(ev.actor).toBe("cardbroker:emily@poke-collect.com");
    expect(ev.detail).toMatchObject({ package: "Box", weightOz: 4.1 });

    // Queue, slip, shipped.
    const q = (await act({ intent: "queue" })) as Record<string, any>;
    expect(q.shipments[0]).toMatchObject({ id: shipment.id, email: null, items: [{ location: expect.any(String), image: expect.stringContaining("img.test") }, {}, {}] });
    expect(((await act({ intent: "slip", id: shipment.id })) as { html: string }).html).toContain("Packing Slip");
    expect(await act({ intent: "shipped", id: shipment.id })).toMatchObject({ ok: true, shipment: { status: "IN_TRANSIT" } });
    // A second Buy Label (stale tab) returns the existing label instead of buying another.
    expect(await act({ intent: "label", id: shipment.id })).toMatchObject({ shipment: { trackingNumber: row.trackingNumber } });
    expect(shippo.labels).toBe(1);

    // Removing the default moves it to the remaining package.
    const small = d1.packages.find((p: { name: string }) => p.name === "Small Mailer");
    expect(await act({ intent: "package-delete", packageId: small.id })).toMatchObject({ packages: [{ name: "Box", isDefault: true }] });
    await expect(act({ intent: "detail", id: "nope" })).rejects.toMatchObject({ status: 404 });
  });
});
