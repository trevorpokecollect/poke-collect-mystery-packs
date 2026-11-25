import { describe, expect, it } from "vitest";
import { sameOrigin, staffUser } from "./staff.server";
import { renderDesk } from "./desk.server";

const req = (headers: Record<string, string> = {}) => new Request("https://site.test/staff/shipping", { method: "POST", headers });
const env = (extra: Record<string, string> = {}) => ({ CARDBIT_SITE: "on", SITE_STAFF_EMAILS: "trevor@example.com, Ops@Example.com", ...extra }) as NodeJS.ProcessEnv;

describe("staff gate", () => {
  const as = (email: string | null) => async () => (email === null ? null : { id: "u", email });
  it("allows listed emails only, case-insensitively", async () => {
    expect(await staffUser(req(), as("ops@example.com"), env())).toEqual({ id: "u", email: "ops@example.com" });
    expect(await staffUser(req(), as("someone@example.com"), env())).toBeNull();
    expect(await staffUser(req(), as(null), env())).toBeNull();
  });
  it("is closed when the site is off or no staff are configured", async () => {
    expect(await staffUser(req(), as("trevor@example.com"), env({ CARDBIT_SITE: "" }))).toBeNull();
    expect(await staffUser(req(), as("trevor@example.com"), env({ SITE_STAFF_EMAILS: "" }))).toBeNull();
  });
  it("requires same-origin posts", () => {
    expect(sameOrigin(req({ origin: "https://site.test", host: "site.test" }))).toBe(true);
    expect(sameOrigin(req({ origin: "https://evil.test", host: "site.test" }))).toBe(false);
    expect(sameOrigin(req({ host: "site.test" }))).toBe(false);
  });
});

describe("desk view", () => {
  const now = new Date("2026-11-25T12:00:00Z");
  const shipment = {
    id: "shp1", customerId: "u1", status: "PAID", toName: "<Ash>", toEmail: "a@b.co",
    toAddress: { name: "<Ash>", street1: "1 Main", city: "Dallas", state: "TX", zip: "75201", country: "US" },
    addressValidated: true, cardCount: 1, feeKind: "CARDBITS", feeBits: 600, feeCents: 0, paymentRef: null,
    idempotencyKey: "k", shippoShipmentId: null, shippoRateId: null, shippoTransactionId: null, carrier: null,
    service: null, postageCents: null, trackingNumber: null, trackingUrl: null, labelUrl: null, trackingStatus: null,
    trackingDetail: null, processBy: new Date("2026-11-27T12:00:00Z"), shippedAt: null, deliveredAt: null,
    canceledAt: null, createdAt: now, updatedAt: now,
    items: [{ id: "i1", shipmentId: "shp1", copyId: "c1", title: "Charizard <ex>", image: "https://img.test/c1.webp", slot: 10001, pocket: 3 }],
  };
  it("shows photo, slot/pocket and Fix Card for a paid shipment, escaped", () => {
    const html = renderDesk(
      { queue: [{ ...shipment, overdue: true }], selected: shipment, rates: null, suggested: null, rateError: null, msg: null, err: "<b>x</b>", labelsLive: false, providerReady: true } as never,
      "trevor@example.com",
    );
    expect(html).toContain('src="https://img.test/c1.webp"');
    expect(html).toContain("Slot 10001 · Pocket 3");
    expect(html).toContain("Fix Card");
    expect(html).toContain("Buy Label");
    expect(html).toContain("Overdue");
    expect(html).toContain("Charizard &lt;ex&gt;");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("Shippo test mode");
  });
  it("hides Fix Card once a label exists", () => {
    const labeled = { ...shipment, status: "LABEL_PURCHASED", trackingNumber: "9400", carrier: "usps", labelUrl: "https://l.test" };
    const html = renderDesk({ queue: [], selected: labeled, rates: null, suggested: null, rateError: null, msg: null, err: null, labelsLive: true, providerReady: true } as never, "t@e.co");
    expect(html).not.toContain("Fix Card");
    expect(html).toContain("Print Label");
  });
});
