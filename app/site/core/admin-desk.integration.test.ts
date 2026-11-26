import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { storeAction, storeState } from "../store/store.server";
import { balanceOf, postLedger } from "./ledger.server";
import { intakeDetails, receiveSiteIntake } from "./stock.server";
import {
  AdminError, addOrderNote, adjustBalance, closeAccount, customerStaffActions, eraseCustomer, exportCustomer, orderDetail, reopenAccount, reversePack, reverseSingle,
} from "./admin-desk.server";
import { bandOf, nexusReport, progress, runNexusAlerts } from "./nexus.server";
import { listOrders } from "./orders-desk.server";
import { confirmAge } from "../../lib/cardbit-age.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const card = (eventKey: string, quantity: number, name: string) => ({
  eventKey, quantity, title: `${name} - 1/100`, game: "pokemon", setName: "Admin Set", number: "1/100",
  name, finish: "Holofoil", language: "English", condition: "Near Mint", priceBits: 500, buybackBits: 400,
});
const rid = () => randomUUID().replace(/-/g, "");
const ACTOR = "cardbroker:staff@cardbit.test";

describe("nexus math", () => {
  it("uses OR, AND and no-tax thresholds", () => {
    expect(progress({ sales: 100_000, txns: 200 }, { cents: 5_000_000, txns: 190 })).toBe(95); // 190/200 beats $50k
    expect(progress({ sales: 500_000, txns: 100, both: true }, { cents: 60_000_000, txns: 50 })).toBe(50); // NY needs both
    expect(progress({ sales: null, txns: null }, { cents: 99_999_999, txns: 9999 })).toBe(0);
    expect([bandOf(69.9), bandOf(70), bandOf(95), bandOf(100)]).toEqual([0, 70, 90, 100]);
  });
  it("validates slab and sealed item details", () => {
    expect(intakeDetails({ rarity: "Rare Holo" })).toEqual({ rarity: "Rare Holo" });
    expect(intakeDetails({ kind: "slab", grader: "PSA", grade: "10", certNumber: "12345678", weightOz: 4.1 })).toMatchObject({ kind: "slab", grader: "PSA", weightOz: 4.1 });
    expect(() => intakeDetails({ kind: "slab", grader: "PSA" })).toThrow();
    expect(() => intakeDetails({ kind: "sealed" })).toThrow();
    expect(() => intakeDetails({ kind: "box" })).toThrow();
  });
});

describe.skipIf(!url)("staff tools", () => {
  let customer: Awaited<ReturnType<typeof db.siteCustomer.create>>;
  const clean = async () => {
    const old = (await db.siteCustomer.findMany({ where: { OR: [{ email: { endsWith: "@admin.test" } }, { email: { endsWith: "erased.cardbit.invalid" } }] }, select: { id: true } })).map((c) => c.id);
    for (const t of [db.cardbitSparkTxn, db.cardbitSparkWallet, db.cardbitXpEvent, db.cardbitProfile] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }[])
      await t.deleteMany({ where: { shop: "cardbit-site" } });
    await db.cardbitAgeConfirmation.deleteMany({ where: { shop: "cardbit-site" } });
    await db.siteStaffAction.deleteMany();
    await db.siteOrderNote.deleteMany();
    await db.siteNexusAlert.deleteMany();
    await db.siteShipment.deleteMany();
    await db.siteRequest.deleteMany();
    await db.siteOpeningFair.deleteMany();
    await db.siteFairSeed.deleteMany();
    await db.siteOpening.deleteMany();
    await db.sitePrice.deleteMany();
    await db.siteCopyEvent.deleteMany();
    await db.siteRestock.deleteMany();
    await db.siteCopy.deleteMany();
    await db.siteIntakeReceipt.deleteMany();
    await db.siteTopup.deleteMany({ where: { customerId: { in: old } } });
    await db.siteLedger.deleteMany();
    await db.siteWallet.deleteMany();
    await db.siteSession.deleteMany({ where: { customerId: { in: old } } });
    await db.siteMarketing.deleteMany({ where: { customerId: { in: old } } });
    await db.siteCustomer.deleteMany({ where: { id: { in: old } } });
  };
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(async () => {
    await clean();
    customer = await db.siteCustomer.create({ data: { email: "ash@admin.test", name: "Ash" } });
    await postLedger(db, { customerId: customer.id, delta: 10_000, kind: "TOPUP", idempotencyKey: `t:${customer.id}` });
    await confirmAge(db, "cardbit-site", customer.id, "signup");
  });
  afterAll(async () => {
    await clean();
    await db.sitePack.updateMany({ data: { active: false } });
    await db.$disconnect();
  });

  it("adjusts a balance once per request, never below zero, with an audit row", async () => {
    const r = rid();
    expect(await adjustBalance(db, ACTOR, { customerId: customer.id, delta: 250, reason: "Goodwill for slow ship", requestId: r })).toMatchObject({ balance: 10_250, replay: false });
    expect(await adjustBalance(db, ACTOR, { customerId: customer.id, delta: 250, reason: "Goodwill for slow ship", requestId: r })).toMatchObject({ replay: true, balance: 10_250 });
    await expect(adjustBalance(db, ACTOR, { customerId: customer.id, delta: -20_000, reason: "Fix", requestId: rid() })).rejects.toThrow(/only 10,250/);
    await expect(adjustBalance(db, ACTOR, { customerId: customer.id, delta: 5, reason: "", requestId: rid() })).rejects.toThrow(AdminError);
    const entry = await db.siteLedger.findFirstOrThrow({ where: { kind: "ADJUST" } });
    expect(entry.note).toBe("Cardbits added by Cardbit support");
    expect(await customerStaffActions(db, customer.id)).toMatchObject([{ action: "adjust", actor: "staff@cardbit.test", reason: "Goodwill for slow ship" }]);
  });

  it("reverses a pack: Cardbits back, cards to Draft, rewards taken back, once; refuses after a buyback", async () => {
    const env = { CARDBIT_SITE: process.env.CARDBIT_SITE, CARDBIT_LEVELS: process.env.CARDBIT_LEVELS, CARDBIT_SPARKS: process.env.CARDBIT_SPARKS };
    Object.assign(process.env, { CARDBIT_SITE: "on", CARDBIT_LEVELS: "on", CARDBIT_SPARKS: "on" });
    try {
      await receiveSiteIntake(db, card("ad:1", 3, "Pikachu"));
      await db.siteCopy.updateMany({ data: { status: "POOLED", packId: "cobalt" } });
      await db.sitePack.update({ where: { id: "cobalt" }, data: { active: true, priceBits: 1000, cardsPerPack: 1 } });
      const o1 = await storeAction(db, customer, { action: "open", requestId: randomUUID(), id: "cobalt" });
      const o2 = await storeAction(db, customer, { action: "open", requestId: randomUUID(), id: "cobalt" });
      expect(await balanceOf(db, customer.id)).toBe(8000);
      const before = await storeState(db, customer);
      expect(before.account?.level?.xp).toBe(40);

      const detail = await orderDetail(db, "PACK", o1.openingId);
      expect(detail.actions).toMatchObject({ canReversePack: true });
      const r = rid();
      expect(await reversePack(db, ACTOR, { openingId: o1.openingId, reason: "Charged twice", requestId: r })).toMatchObject({ refundedBits: 1000, balance: 9000, cards: 1 });
      expect((await reversePack(db, ACTOR, { openingId: o1.openingId, reason: "Charged twice", requestId: r })).replay).toBe(true);
      await expect(reversePack(db, ACTOR, { openingId: o1.openingId, reason: "Again", requestId: rid() })).rejects.toThrow(/already reversed/);
      const copy = await db.siteCopy.findFirstOrThrow({ where: { openingId: String(o1.openingId) } });
      expect(copy).toMatchObject({ status: "DRAFT", ownerId: null, autoRestock: true });
      const after = await storeState(db, customer);
      expect(after.account?.level?.xp).toBe(20);
      expect(after.openings.find((o) => o.id === o1.openingId)).toMatchObject({ reversed: true, cards: [] });
      expect(after.binder.some((c) => c.id === copy.id)).toBe(false);
      expect((await listOrders(db, { type: "PACK" })).orders.find((o) => o.id === o1.openingId)?.status).toBe("Reversed");

      // Sold back first: reversal refused, staff use Adjust Balance.
      const c2 = await db.siteCopy.findFirstOrThrow({ where: { openingId: String(o2.openingId) } });
      await storeAction(db, customer, { action: "buyback", requestId: randomUUID(), id: c2.id, amount: 400 });
      await expect(reversePack(db, ACTOR, { openingId: o2.openingId, reason: "Wants refund", requestId: rid() })).rejects.toThrow(/left the vault/);
      expect((await orderDetail(db, "PACK", o2.openingId)).actions).toMatchObject({ canReversePack: false });

      const timeline = (await orderDetail(db, "PACK", o1.openingId)).timeline.map((e) => e.kind);
      expect(timeline).toEqual(expect.arrayContaining(["order", "cardbits", "card", "staff"]));
    } finally {
      for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it("reverses a single purchase back to Draft, once", async () => {
    await receiveSiteIntake(db, card("ad:s", 1, "Eevee"));
    await db.siteCopy.updateMany({ data: { status: "FOR_SALE" } });
    const state = await storeState(db, customer);
    await storeAction(db, customer, { action: "buy", requestId: randomUUID(), id: state.singles[0].id });
    const buy = await db.siteLedger.findFirstOrThrow({ where: { kind: "SINGLE" } });
    expect(await reverseSingle(db, ACTOR, { ledgerId: buy.id, reason: "Damaged corner", requestId: rid() })).toMatchObject({ refundedBits: 500, balance: 10_000 });
    await expect(reverseSingle(db, ACTOR, { ledgerId: buy.id, reason: "Damaged corner", requestId: rid() })).rejects.toThrow(/already reversed/);
    expect(await db.siteCopy.findFirstOrThrow()).toMatchObject({ status: "DRAFT", ownerId: null });
    const d = await orderDetail(db, "SINGLE", buy.id);
    expect(d.summary.status).toBe("Reversed");
  });

  it("keeps order notes on the order page", async () => {
    const t = await db.siteTopup.create({ data: { customerId: customer.id, baseBits: 1000, bonusBits: 0, cents: 1000, status: "CREDITED", billingState: "TX", billingZip: "75001", paymentId: "pay_1" } });
    await addOrderNote(db, ACTOR, { type: "TOPUP", ref: t.id, body: "Customer called about receipt" });
    await expect(addOrderNote(db, ACTOR, { type: "TOPUP", ref: t.id, body: "  " })).rejects.toThrow(AdminError);
    const d = await orderDetail(db, "TOPUP", t.id);
    expect(d.notes).toMatchObject([{ body: "Customer called about receipt", actor: "staff@cardbit.test" }]);
    expect(d.summary.refundHint).toMatch(/Coinflow dashboard/);
  });

  it("closes, reopens, exports and erases (keeping transaction records)", async () => {
    await db.siteSession.create({ data: { id: "s1-admin", customerId: customer.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    await db.siteMarketing.create({ data: { customerId: customer.id, emailOptInAt: new Date(), smsPhone: "+12565550111" } });
    await expect(eraseCustomer(db, ACTOR, { customerId: customer.id, reason: "Privacy request", requestId: rid(), confirmEmail: customer.email })).rejects.toThrow(/Close the account/);
    await closeAccount(db, ACTOR, { customerId: customer.id, reason: "Customer asked", requestId: rid() });
    expect((await db.siteSession.findUniqueOrThrow({ where: { id: "s1-admin" } })).revokedAt).not.toBeNull();
    await reopenAccount(db, ACTOR, { customerId: customer.id, reason: "Changed mind", requestId: rid() });
    expect((await db.siteCustomer.findUniqueOrThrow({ where: { id: customer.id } })).closedAt).toBeNull();
    await closeAccount(db, ACTOR, { customerId: customer.id, reason: "Privacy request", requestId: rid() });

    const ex = await exportCustomer(db, ACTOR, { customerId: customer.id, reason: "Access request", requestId: rid() });
    expect(ex.account.email).toBe("ash@admin.test");
    expect(ex.marketing?.smsPhone).toBe("+12565550111");
    expect(ex.balance).toBe(10_000);

    await expect(eraseCustomer(db, ACTOR, { customerId: customer.id, reason: "Privacy request", requestId: rid(), confirmEmail: "wrong@x.test" })).rejects.toThrow(/Type the customer's email/);
    await eraseCustomer(db, ACTOR, { customerId: customer.id, reason: "Privacy request", requestId: rid(), confirmEmail: customer.email });
    const gone = await db.siteCustomer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(gone.email).toMatch(/@erased\.cardbit\.invalid$/);
    expect(gone.name).toBeNull();
    expect((await db.siteMarketing.findUniqueOrThrow({ where: { customerId: customer.id } })).smsPhone).toBeNull();
    expect(await db.siteLedger.count({ where: { customerId: customer.id } })).toBe(1); // records kept
    await expect(reopenAccount(db, ACTOR, { customerId: customer.id, reason: "x x x", requestId: rid() })).rejects.toThrow(/Erased/);
  });

  it("tracks nexus per state and alerts once per band", async () => {
    const yr = new Date().getUTCFullYear();
    const now = new Date(Date.UTC(yr, 10, 20));
    // FL: $75,000 of paid top-ups this year → 75% band 70. Refunded top-ups don't count.
    await db.siteTopup.create({ data: { customerId: customer.id, baseBits: 1, bonusBits: 0, cents: 7_500_000, status: "CREDITED", billingState: "fl", billingZip: "33101", createdAt: new Date(Date.UTC(yr, 5, 1)) } });
    await db.siteTopup.create({ data: { customerId: customer.id, baseBits: 1, bonusBits: 0, cents: 9_000_000, status: "REFUNDED", billingState: "FL", billingZip: "33101", createdAt: new Date(Date.UTC(yr, 5, 2)) } });
    const report = await nexusReport(db, now);
    const fl = report.rows.find((r) => r.state === "FL")!;
    expect(fl).toMatchObject({ pct: 75, band: 70 });
    expect(report.rows[0].state).toBe("FL");
    const sent: string[] = [];
    const mailer = { live: false, send: async (m: { to: string; subject: string }) => { sent.push(m.subject); return { id: "x" }; } } as never;
    const env = { SITE_NEXUS_ALERT_EMAILS: "owner@admin.test" } as NodeJS.ProcessEnv;
    expect((await runNexusAlerts(db, env, mailer, now)).sent).toBe(1);
    expect((await runNexusAlerts(db, env, mailer, now)).sent).toBe(0);
    expect(sent).toEqual(["Cardbit: sales tax nexus alert (FL)"]);
  });
});
