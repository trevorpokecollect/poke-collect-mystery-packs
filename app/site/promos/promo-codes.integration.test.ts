import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listPromos, promoBonus, quotePromo, releasePendingUses, savePromo, setPromoActive } from "./promo-codes.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });

describe("promoBonus", () => {
  it("computes percent (rounded down, capped) and flat bonuses", () => {
    expect(promoBonus({ kind: "PERCENT", value: 10, maxBonusBits: null }, 5000)).toBe(500);
    expect(promoBonus({ kind: "PERCENT", value: 15, maxBonusBits: null }, 1001)).toBe(150);
    expect(promoBonus({ kind: "PERCENT", value: 20, maxBonusBits: 2000 }, 50000)).toBe(2000);
    expect(promoBonus({ kind: "FLAT", value: 500, maxBonusBits: null }, 1000)).toBe(500);
  });
});

describe.skipIf(!url)("promo codes", () => {
  let a = "";
  let b = "";
  const topup = (customerId: string, extra: Record<string, unknown> = {}) =>
    db.siteTopup.create({ data: { customerId, baseBits: 5000, bonusBits: 500, cents: 5000, billingState: "TX", billingZip: "75001", ...extra } });

  beforeAll(async () => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(async () => {
    a = (await db.siteCustomer.upsert({ where: { email: "promo-a@example.com" }, update: {}, create: { email: "promo-a@example.com" } })).id;
    b = (await db.siteCustomer.upsert({ where: { email: "promo-b@example.com" }, update: {}, create: { email: "promo-b@example.com" } })).id;
    await db.siteTopup.deleteMany({ where: { customerId: { in: [a, b] } } });
    await db.sitePromoCode.deleteMany({ where: { code: { startsWith: "PT-" } } });
  });
  afterAll(async () => {
    await db.siteTopup.deleteMany({ where: { customerId: { in: [a, b] } } });
    await db.sitePromoCode.deleteMany({ where: { code: { startsWith: "PT-" } } });
    await db.$disconnect();
  });

  const q = (code: string, customerId: string, cents = 5000, now?: Date) => quotePromo(db, { code, customerId, cents, baseBits: cents, now });

  it("returns null with no code and rejects unknown or paused codes", async () => {
    expect(await q("", a)).toBeNull();
    await expect(q("PT-NOPE", a)).rejects.toThrow("isn't valid");
    await savePromo(db, { code: "pt-ten", kind: "percent", value: 10 }, "staff@example.com");
    expect(await q(" pt-ten ", a)).toEqual({ code: "PT-TEN", bonusBits: 500 });
    await setPromoActive(db, "PT-TEN", false);
    await expect(q("PT-TEN", a)).rejects.toThrow("isn't valid");
  });

  it("checks dates, minimum and first top-up", async () => {
    await savePromo(db, { code: "PT-WIN", kind: "FLAT", value: 300, minCents: 5000, startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-12-31T00:00:00Z", firstTopupOnly: true }, null);
    await expect(q("PT-WIN", a, 5000, new Date("2026-11-30T00:00:00Z"))).rejects.toThrow("isn't active yet");
    await expect(q("PT-WIN", a, 5000, new Date("2027-01-01T00:00:00Z"))).rejects.toThrow("expired");
    const dec = new Date("2026-12-10T00:00:00Z");
    await expect(q("PT-WIN", a, 1000, dec)).rejects.toThrow("$50 or more");
    expect(await q("PT-WIN", a, 5000, dec)).toEqual({ code: "PT-WIN", bonusBits: 300 });
    await topup(a, { status: "CREDITED" });
    await expect(q("PT-WIN", a, 5000, dec)).rejects.toThrow("first top-up only");
  });

  it("allows one paid use per customer, and the total cap counts others' paid and fresh pending uses", async () => {
    await savePromo(db, { code: "PT-CAP", kind: "FLAT", value: 250, maxUses: 1 }, null);
    await topup(a, { promoCode: "PT-CAP", promoBits: 250, status: "PENDING" });
    expect(await q("PT-CAP", a)).toMatchObject({ bonusBits: 250 }); // own unpaid checkout doesn't block a retry
    await expect(q("PT-CAP", b)).rejects.toThrow("fully used"); // a's checkout holds the only slot
    await db.siteTopup.updateMany({ where: { customerId: a }, data: { createdAt: new Date(Date.now() - 2 * 3600_000) } });
    expect(await q("PT-CAP", b)).toMatchObject({ bonusBits: 250 }); // stale pending frees the slot
    await db.siteTopup.updateMany({ where: { customerId: a }, data: { status: "CREDITED" } });
    await expect(q("PT-CAP", a)).rejects.toThrow("already used");
    await expect(q("PT-CAP", b)).rejects.toThrow("fully used");
  });

  it("moves the code off a customer's older unpaid checkouts", async () => {
    await savePromo(db, { code: "PT-MOVE", kind: "FLAT", value: 400 }, null);
    const old = await topup(a, { promoCode: "PT-MOVE", promoBits: 400, bonusBits: 900 });
    expect(await releasePendingUses(db, "PT-MOVE", a)).toBe(1);
    expect(await db.siteTopup.findUnique({ where: { id: old.id } })).toMatchObject({ promoCode: null, promoBits: 0, bonusBits: 500 });
  });

  it("validates staff input, locks the bonus once used, and lists stats", async () => {
    await expect(savePromo(db, { code: "x", kind: "FLAT", value: 1 }, null)).rejects.toThrow("2–32");
    await expect(savePromo(db, { code: "PT-BAD", kind: "PERCENT", value: 150 }, null)).rejects.toThrow("1 to 100");
    await savePromo(db, { code: "PT-LIST", kind: "PERCENT", value: 10, maxBonusBits: 1000, note: "Discord launch" }, "staff@example.com");
    await topup(a, { promoCode: "PT-LIST", promoBits: 500, bonusBits: 1000, status: "CREDITED" });
    await expect(savePromo(db, { code: "PT-LIST", kind: "PERCENT", value: 20 }, null)).rejects.toThrow("can't change");
    await savePromo(db, { code: "PT-LIST", kind: "PERCENT", value: 10, maxUses: 100 }, null); // limits can still change
    const row = (await listPromos(db)).find((r) => r.code === "PT-LIST");
    expect(row).toMatchObject({ uses: 1, bonusBits: 500, cents: 5000, maxUses: 100, createdBy: "staff@example.com" });
  });
});
