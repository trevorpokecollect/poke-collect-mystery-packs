import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { priceKey, receiveSiteIntake } from "./stock.server";
import { stockValue } from "./stock-desk.server";
import { listCustomers, listOrders } from "./orders-desk.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const card = (eventKey: string, quantity: number, name: string) => ({
  eventKey, quantity, title: `${name} - 3/100`, game: "pokemon", setName: "Orders Set", number: "3/100",
  name, finish: "Normal", language: "English", condition: "Near Mint",
});

describe.skipIf(!url)("orders desk", () => {
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(async () => {
    await db.sitePrice.deleteMany();
    await db.siteCopyEvent.deleteMany();
    await db.siteRestock.deleteMany();
    await db.siteCopy.deleteMany();
    await db.siteIntakeReceipt.deleteMany();
    await db.siteLedger.deleteMany({ where: { idempotencyKey: { startsWith: "od:" } } });
    await db.siteTopup.deleteMany({ where: { paymentId: { startsWith: "od:" } } });
    await db.siteOpening.deleteMany({ where: { priceBits: 777 } });
  });
  afterAll(() => db.$disconnect());

  it("values stock by status from copy overrides and printing prices", async () => {
    await receiveSiteIntake(db, card("od:1", 3, "Psyduck"));
    const c = await db.siteCopy.findFirstOrThrow();
    await db.sitePrice.create({ data: { printingKey: priceKey(c.printingKey, c.condition), retailBits: 500, buybackBits: 400 } });
    await db.siteCopy.update({ where: { id: c.id }, data: { retailBits: 900, demo: true } });
    const v = await stockValue(db);
    expect(v.DRAFT).toEqual({ copies: 3, demo: 1, retailBits: 1900, buybackBits: 1200, unpriced: 0 });
  });

  it("merges packs, singles, buybacks and top-ups newest first, with filters and email", async () => {
    const email = `od-${Date.now()}@example.com`;
    const customer = await db.siteCustomer.create({ data: { email } });
    await receiveSiteIntake(db, card("od:2", 1, "Golduck"));
    const c = await db.siteCopy.findFirstOrThrow();
    const t0 = Date.now();
    await db.siteOpening.create({ data: { customerId: customer.id, packId: "cobalt", priceBits: 777, revealedAt: new Date(), createdAt: new Date(t0 - 3000) } });
    await db.siteLedger.create({ data: { customerId: customer.id, delta: -300, balanceAfter: 0, kind: "SINGLE", ref: c.id, idempotencyKey: "od:s", createdAt: new Date(t0 - 2000) } });
    await db.siteLedger.create({ data: { customerId: customer.id, delta: 200, balanceAfter: 200, kind: "BUYBACK", ref: c.id, idempotencyKey: "od:b", createdAt: new Date(t0 - 1000) } });
    await db.siteTopup.create({ data: { customerId: customer.id, baseBits: 1000, bonusBits: 0, cents: 1000, status: "CREDITED", paymentId: "od:t", billingState: "TX", billingZip: "75001", createdAt: new Date(t0) } });
    const all = await listOrders(db, { q: email });
    expect(all.orders.map((o) => o.type)).toEqual(["TOPUP", "BUYBACK", "SINGLE", "PACK"]);
    expect(all.orders[0]).toMatchObject({ email, cents: 1000, bits: 1000 });
    expect(all.orders[2]).toMatchObject({ title: "Golduck - 3/100", bits: -300 });
    const page = await listOrders(db, { q: email, limit: 2 });
    expect(page.orders).toHaveLength(2);
    const rest = await listOrders(db, { q: email, before: page.next! });
    expect(rest.orders.map((o) => o.type)).toEqual(["SINGLE", "PACK"]);
    expect((await listOrders(db, { q: email, type: "PACK" })).orders).toHaveLength(1);
    const list = await listCustomers(db, { q: email });
    expect(list.customers[0]).toMatchObject({ email, packsOpened: 1, packBits: 777, toppedUpCents: 1000 });
  });
});
