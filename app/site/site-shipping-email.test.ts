import { describe, expect, it } from "vitest";
import { assertAllowedRegion, RegionBlocked, stateCode } from "./region.server";
import { cardsUntilFree, parcelFor, processBy, shippingFee } from "./shipping/policy";
import { parseAddress, pickRate, ShippingError, statusFromTracking } from "./shipping/service.server";
import { renderEmail, type EmailData, type EmailKind } from "./email/templates";
import { ResendMailer, MailRejected } from "./email/mailer.server";
import type { Rate } from "./shipping/shippo.server";

const okBilling = { country: "US", state: "TX" };

describe("region guard", () => {
  it("allows an ordinary US state", async () => {
    await expect(assertAllowedRegion({ action: "topup", billing: okBilling })).resolves.toEqual({ ipChecked: false, ipRegion: null });
  });
  it.each(["AL", "HI", "ID", "MN", "NV", "NY", "UT", "WA", "ny"])("blocks billing in %s", async (st) => {
    await expect(assertAllowedRegion({ action: "pack_purchase", billing: { country: "US", state: st } })).rejects.toMatchObject({
      code: "EXCLUDED_STATE",
      source: "billing",
    });
  });
  it("blocks non-US billing and unknown states", async () => {
    await expect(assertAllowedRegion({ action: "topup", billing: { country: "CA", state: "ON" } })).rejects.toMatchObject({ code: "NOT_US" });
    await expect(assertAllowedRegion({ action: "topup", billing: { country: "US", state: "PR" } })).rejects.toMatchObject({ code: "UNKNOWN_STATE" });
  });
  it("requires and checks the delivery address for shipping", async () => {
    await expect(assertAllowedRegion({ action: "shipping", billing: okBilling })).rejects.toBeInstanceOf(RegionBlocked);
    await expect(
      assertAllowedRegion({ action: "shipping", billing: okBilling, shipping: { country: "US", state: "WA" } }),
    ).rejects.toMatchObject({ code: "EXCLUDED_STATE", source: "shipping" });
  });
  it("blocks by IP country and state, ignores lookup failures and private IPs", async () => {
    const geo = async (ip: string) =>
      ip === "1.1.1.1" ? { country: "US", region: "NV" } : ip === "2.2.2.2" ? { country: "GB" } : ip === "3.3.3.3" ? { country: "US", region: "TX" } : null;
    await expect(assertAllowedRegion({ action: "topup", billing: okBilling, ip: "1.1.1.1" }, geo)).rejects.toMatchObject({ code: "IP_EXCLUDED_STATE" });
    await expect(assertAllowedRegion({ action: "topup", billing: okBilling, ip: "2.2.2.2" }, geo)).rejects.toMatchObject({ code: "IP_NOT_US" });
    await expect(assertAllowedRegion({ action: "topup", billing: okBilling, ip: "3.3.3.3" }, geo)).resolves.toEqual({ ipChecked: true, ipRegion: "TX" });
    await expect(assertAllowedRegion({ action: "topup", billing: okBilling, ip: "9.9.9.9" }, geo)).resolves.toMatchObject({ ipChecked: false });
    await expect(assertAllowedRegion({ action: "topup", billing: okBilling, ip: "10.0.0.4" }, geo)).resolves.toMatchObject({ ipChecked: false });
    const broken = async () => { throw new Error("down"); };
    await expect(assertAllowedRegion({ action: "topup", billing: okBilling, ip: "3.3.3.3" }, broken)).resolves.toMatchObject({ ipChecked: false });
  });
  it("maps state names", () => {
    expect(stateCode("New York")).toBe("NY");
    expect(stateCode("tx")).toBe("TX");
    expect(stateCode("Atlantis")).toBeNull();
  });
});

describe("shipping policy", () => {
  it("charges $6 or 600 Cardbits up to 30 cards, free over 30", () => {
    expect(shippingFee(1, "CARDBITS")).toEqual({ kind: "CARDBITS", bits: 600, cents: 0 });
    expect(shippingFee(30, "USD")).toEqual({ kind: "USD", bits: 0, cents: 600 });
    expect(shippingFee(31, "CARDBITS")).toEqual({ kind: "FREE", bits: 0, cents: 0 });
    expect(shippingFee(2, "CARDBITS", 9_999).kind).toBe("CARDBITS");
    expect(shippingFee(2, "CARDBITS", 10_000)).toEqual({ kind: "FREE", bits: 0, cents: 0 });
    expect(cardsUntilFree(30)).toBe(1);
    expect(cardsUntilFree(31)).toBe(0);
    expect(() => shippingFee(0, "USD")).toThrow();
    expect(() => shippingFee(1.5, "USD")).toThrow();
  });
  it("promises processing within 48 hours", () => {
    const t = new Date("2026-11-25T00:00:00Z");
    expect(processBy(t).toISOString()).toBe("2026-11-27T00:00:00.000Z");
  });
  it("sizes parcels by card count", () => {
    expect(parcelFor(1, {}).template).toBe("mailer-small");
    expect(parcelFor(30, {}).template).toBe("mailer-large");
    expect(parcelFor(100, {}).template).toBe("box-small");
    expect(parcelFor(10, {}).weightOz).toBe(4);
  });
  it("picks the preferred service, cheapest first", () => {
    const r = (token: string, cents: number) => ({ rateId: token + cents, serviceToken: token, amountCents: cents }) as Rate;
    expect(pickRate([r("usps_priority", 900), r("usps_ground_advantage", 520), r("usps_ground_advantage", 480)])?.rateId).toBe("usps_ground_advantage480");
    expect(pickRate([r("fedex_2day", 2000)])).toBeNull();
  });
  it("maps carrier tracking to shipment status", () => {
    expect(statusFromTracking("PRE_TRANSIT")).toBeNull();
    expect(statusFromTracking("TRANSIT")).toBe("IN_TRANSIT");
    expect(statusFromTracking("FAILURE")).toBe("EXCEPTION");
  });
  it("validates the typed address", () => {
    expect(parseAddress({ name: " Ash ", street1: "1 Main", city: "Austin", state: "tx", zip: "78701" })).toMatchObject({
      name: "Ash",
      state: "TX",
      country: "US",
    });
    try {
      parseAddress({ name: "", street1: "", city: "", state: "Texas", zip: "7870" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ShippingError);
      expect((e as ShippingError).details).toHaveLength(5);
    }
  });
});

const samples: { [K in EmailKind]: EmailData[K] } = {
  signin_code: { code: "482913", minutes: 10 },
  topup_receipt: { orderId: "ord_1", paidCents: 10000, bits: 10000, bonusBits: 500, balanceBits: 12500, paymentLabel: "Visa •4242" },
  pack_receipt: { orderId: "ord_2", lines: [{ name: "Booster Pack", quantity: 2, bits: 2598 }], totalBits: 2598, balanceBits: 9902 },
  pack_opened: { packName: "Gold Pack", cards: [{ title: "Charizard <ex> 199/165", offerBits: 4800 }, { title: "Pikachu 173" }] },
  buyback_confirmation: { cards: [{ title: "Slowking 14", bits: 1200 }], totalBits: 1200, balanceBits: 2400 },
  shipment_created: {
    shipmentId: "shp_1",
    cards: ["Aipom 026", "Clefairy 184"],
    feeKind: "CARDBITS",
    processBy: "2026-11-27T00:00:00Z",
    address: { name: "Ash K", street1: "1 Main St", city: "Austin", state: "TX", zip: "78701" },
  },
  shipment_shipped: { shipmentId: "shp_1", cards: ["Aipom 026"], carrier: "usps", trackingNumber: "9400100000000000000000", trackingUrl: "https://tools.usps.com/x" },
  shipment_delivered: { shipmentId: "shp_1", cardCount: 2, trackingUrl: null },
};

describe("email templates", () => {
  for (const kind of Object.keys(samples) as EmailKind[]) {
    it(`renders ${kind}`, () => {
      const r = renderEmail(kind, samples[kind] as never, { CARDBIT_SITE_URL: "https://site.test" });
      expect(r.subject.length).toBeGreaterThan(5);
      expect(r.html).toContain("cardbit");
      expect(r.html).toContain("Hosted by Poke-Collect.");
      expect(r.text).toContain("hello@cardbit.com");
      expect(r.html).not.toMatch(/\$\d+\.\d\d.*retail/i);
      expect(r.html).not.toContain("<ex>");
    });
  }
  it("escapes card titles and uses Cardbits wording", () => {
    const r = renderEmail("pack_opened", samples.pack_opened, {});
    expect(r.html).toContain("Charizard &lt;ex&gt;");
    expect(r.html).toContain("4,800 Cardbits");
  });
  it("labels shipping fee per policy", () => {
    expect(renderEmail("shipment_created", { ...samples.shipment_created, feeKind: "FREE" }, {}).html).toContain("Free shipping");
  });
});

describe("Resend mailer", () => {
  it("sends with an idempotency key and maps 422 to MailRejected", async () => {
    const calls: RequestInit[] = [];
    const ok = (async (_u: string, init: RequestInit) => {
      calls.push(init);
      return new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const m = new ResendMailer("re_x", "Cardbit <hello@cardbit.com>", "hello@cardbit.com", ok);
    await expect(m.send({ to: "a@b.co", subject: "s", html: "h", text: "t", idempotencyKey: "k1" })).resolves.toEqual({ id: "em_1" });
    expect((calls[0].headers as Record<string, string>)["Idempotency-Key"]).toBe("k1");
    const bad = (async () => new Response(JSON.stringify({ message: "invalid to" }), { status: 422 })) as unknown as typeof fetch;
    await expect(new ResendMailer("re_x", "f", "r", bad).send({ to: "x", subject: "s", html: "h", text: "t", idempotencyKey: "k" })).rejects.toBeInstanceOf(MailRejected);
  });
});
