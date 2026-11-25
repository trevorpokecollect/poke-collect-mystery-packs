import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { customerRecord, emailStatus, listCustomerRecords, normalizeTags, smsStatus, updateCustomerRecord } from "./customer-records.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const d = (s: string) => new Date(s);

describe("consent status", () => {
  const none = { emailOptInAt: null, emailOptOutAt: null, smsRequestedAt: null, smsConfirmedAt: null, smsOptOutAt: null };
  it("reads email and SMS status like Shopify", () => {
    expect(emailStatus(null)).toBe("never");
    expect(emailStatus({ ...none, emailOptInAt: d("2026-11-01") })).toBe("subscribed");
    expect(emailStatus({ ...none, emailOptInAt: d("2026-11-01"), emailOptOutAt: d("2026-11-02") })).toBe("unsubscribed");
    expect(emailStatus({ ...none, emailOptInAt: d("2026-11-03"), emailOptOutAt: d("2026-11-02") })).toBe("subscribed");
    expect(smsStatus({ ...none, smsRequestedAt: d("2026-11-01") })).toBe("pending");
    expect(smsStatus({ ...none, smsRequestedAt: d("2026-11-01"), smsConfirmedAt: d("2026-11-01") })).toBe("subscribed");
    expect(smsStatus({ ...none, smsRequestedAt: d("2026-11-01"), smsConfirmedAt: d("2026-11-01"), smsOptOutAt: d("2026-11-05") })).toBe("unsubscribed");
  });
  it("normalizes tags", () => {
    expect(normalizeTags(" VIP, whale ,vip,,  Big   Spender ")).toEqual(["vip", "whale", "big spender"]);
  });
});

describe.skipIf(!url)("customer records", () => {
  const ids: string[] = [];
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  const clean = async () => {
    const old = (await db.siteCustomer.findMany({ where: { email: { startsWith: "cr-" } }, select: { id: true } })).map((c) => c.id);
    await db.siteTopup.deleteMany({ where: { customerId: { in: old } } });
    await db.siteLedger.deleteMany({ where: { customerId: { in: old } } });
    await db.siteShipment.deleteMany({ where: { customerId: { in: old } } });
    await db.siteMarketing.deleteMany({ where: { customerId: { in: old } } });
    await db.siteCustomer.deleteMany({ where: { id: { in: old } } });
  };
  beforeEach(async () => {
    await clean();
    ids.length = 0;
    const a = await db.siteCustomer.create({ data: { email: "cr-a@example.com", name: "Ash", signupMethod: "google", tags: ["vip"], createdAt: d("2026-11-20T12:00:00Z") } });
    const b = await db.siteCustomer.create({ data: { email: "cr-b@example.com", signupMethod: "email", createdAt: d("2026-11-21T12:00:00Z") } });
    ids.push(a.id, b.id);
    await db.siteMarketing.create({ data: { customerId: a.id, emailOptInAt: d("2026-11-20T12:00:00Z"), emailSource: "welcome-rewards", smsPhone: "+12565550100", smsRequestedAt: d("2026-11-20T12:01:00Z") } });
    await db.siteTopup.create({ data: { customerId: a.id, baseBits: 5000, bonusBits: 0, cents: 5000, status: "CREDITED", billingState: "TX", billingZip: "75001", createdAt: d("2026-11-22T12:00:00Z") } });
    await db.siteTopup.create({ data: { customerId: a.id, baseBits: 1000, bonusBits: 0, cents: 1000, status: "PENDING", billingState: "TX", billingZip: "75001" } });
    await db.siteLedger.create({ data: { customerId: a.id, delta: 5000, balanceAfter: 5000, kind: "TOPUP", idempotencyKey: `cr-top-${a.id}` } });
    await db.siteLedger.create({ data: { customerId: a.id, delta: -1200, balanceAfter: 3800, kind: "SINGLE", idempotencyKey: `cr-single-${a.id}`, createdAt: d("2026-11-23T12:00:00Z") } });
    const addr = { name: "Ash K", street1: "1 Main St", city: "Austin", state: "TX", zip: "78701", country: "US" };
    for (const k of ["1", "2"])
      await db.siteShipment.create({ data: { customerId: a.id, toName: "Ash K", toAddress: addr, cardCount: 1, feeKind: "USD", idempotencyKey: `cr-ship-${k}-${a.id}`, processBy: new Date() } });
  });
  afterAll(async () => {
    await clean();
    await db.$disconnect();
  });

  it("lists with consent, tags, orders and amount spent, and filters", async () => {
    const all = await listCustomerRecords(db, { q: "cr-" });
    const a = all.customers.find((c) => c.email === "cr-a@example.com")!;
    expect(a).toMatchObject({ emailStatus: "subscribed", smsStatus: "pending", tags: ["vip"], orders: 2, spentCents: 5000, lastOrderAt: "2026-11-23T12:00:00.000Z" });
    expect(all.tags).toContainEqual({ tag: "vip", count: expect.any(Number) });
    const ids2 = (r: Awaited<ReturnType<typeof listCustomerRecords>>) => r.customers.map((c) => c.email);
    expect(ids2(await listCustomerRecords(db, { q: "cr-", email: "subscribed" }))).toEqual(["cr-a@example.com"]);
    expect(ids2(await listCustomerRecords(db, { q: "cr-", email: "never" }))).toEqual(["cr-b@example.com"]);
    expect(ids2(await listCustomerRecords(db, { q: "cr-", buyer: "no" }))).toEqual(["cr-b@example.com"]);
    expect(ids2(await listCustomerRecords(db, { tag: "VIP" }))).toContain("cr-a@example.com");
    expect(ids2(await listCustomerRecords(db, { q: "cr-", sort: "spent" }))[0]).toBe("cr-a@example.com");
    const page = await listCustomerRecords(db, { q: "cr-", limit: 1 });
    expect(page).toMatchObject({ matched: 2, next: 1 });
  });

  it("returns the full record and applies staff edits", async () => {
    const r = (await customerRecord(db, ids[0]))!;
    expect(r.consent.email).toMatchObject({ status: "subscribed", source: "welcome-rewards" });
    expect(r.consent.sms).toMatchObject({ status: "pending", phone: "+12565550100" });
    expect(r.stats).toMatchObject({ orders: 2, topups: 1, singlesBought: 1, spentCents: 5000, paidBits: 5000, singleBits: 1200, shipments: 2 });
    expect(r.addresses).toHaveLength(1); // same address twice
    expect(r.addresses[0]).toMatchObject({ line1: "1 Main St", city: "Austin", zip: "78701" });
    expect(r.orders.length).toBeGreaterThan(0);

    const u = (await updateCustomerRecord(db, ids[0], { tags: "VIP, Discord", note: " Prefers texts ", unsubscribe: "email" }))!;
    expect(u.tags).toEqual(["vip", "discord"]);
    expect(u.note).toBe("Prefers texts");
    expect(u.consent.email).toMatchObject({ status: "unsubscribed", source: "staff" });
    expect(u.consent.syncedAt).toBeNull(); // Klaviyo sync picks it up
    await expect(updateCustomerRecord(db, ids[0], { unsubscribe: "push" })).rejects.toThrow("Choose email or SMS");
    expect(await customerRecord(db, "nope")).toBeNull();
  });
});
