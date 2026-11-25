import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { storeAction, storeState } from "../store/store.server";
import { DemoError, demoSummary, giveDemoPacks, giveDemoVaultCards, grantDemoCardbits, markDemo, wipeDemo } from "./demo.server";
import { balanceOf, postLedger } from "./ledger.server";
import { receiveSiteIntake } from "./stock.server";
import { movePool, setPrice } from "./stock-desk.server";
import { publishRestock } from "./restock.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const EMAIL = "demo@demo.test";
const card = (eventKey: string, quantity: number, name: string, n: number) => ({
  eventKey, quantity, title: `${name} - ${n}/100`, game: "pokemon", setName: "Demo Set", number: `${n}/100`,
  name, finish: "Holofoil", language: "English", condition: "Near Mint",
});
const clean = async () => {
  await db.siteShipment.deleteMany();
  await db.siteRequest.deleteMany();
  await db.siteOpening.deleteMany();
  await db.sitePrice.deleteMany();
  await db.siteCopyEvent.deleteMany();
  await db.siteRestock.deleteMany();
  await db.siteCopy.deleteMany();
  await db.siteIntakeReceipt.deleteMany();
  await db.siteLedger.deleteMany();
  await db.siteWallet.deleteMany();
  await db.siteCustomer.deleteMany({ where: { email: { endsWith: ".test" } } });
};

describe.skipIf(!url)("demo panel", () => {
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(clean);
  afterAll(async () => {
    await clean();
    await db.sitePack.updateMany({ data: { active: false } });
    await db.$disconnect();
  });

  it("credits, gives packs and vault cards from demo stock only, and wipes it all", async () => {
    // Real (non-demo) stock that must survive.
    await receiveSiteIntake(db, card("real:1", 2, "Realmon", 1));
    const real = await db.siteCopy.findMany();
    await setPrice(db, "t", real[0].printingKey, real[0].condition, 500, 400);
    await movePool(db, "t", [real[0].id], "prism");

    for (let i = 0; i < 8; i++) await receiveSiteIntake(db, card(`demo:${i}`, 2, `Demomon${i}`, 10 + i));
    const demo = await db.siteCopy.findMany({ where: { name: { startsWith: "Demomon" } } });
    expect(await markDemo(db, "t", demo.map((c) => c.id), true)).toEqual({ changed: 16 });
    for (const c of demo) await setPrice(db, "t", c.printingKey, c.condition, 300, 240);
    await movePool(db, "t", demo.slice(0, 10).map((c) => c.id), "prism"); // 2 Booster packs of demo cards
    await publishRestock(db, "t", "prism");

    const rid = randomUUID();
    const credit = await grantDemoCardbits(db, "t", EMAIL, "50,000", rid);
    expect(credit).toMatchObject({ bits: 50000, balance: 50000, replay: false });
    expect((await grantDemoCardbits(db, "t", EMAIL, 50000, rid)).replay).toBe(true);
    const customer = await db.siteCustomer.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(await balanceOf(db, customer.id)).toBe(50000);

    await expect(giveDemoPacks(db, "t", EMAIL, "prism", 3)).rejects.toThrow(DemoError); // only 10 demo cards pooled
    const packs = await giveDemoPacks(db, "t", EMAIL, "prism", 2);
    expect(packs.openings).toHaveLength(2);
    expect(await db.siteCopy.count({ where: { id: real[0].id, status: "POOLED" } })).toBe(1); // real copy untouched

    const vault = await giveDemoVaultCards(db, "t", EMAIL, 4);
    expect(vault.copies).toHaveLength(4);
    let state = await storeState(db, customer);
    expect(state.account?.bits).toBe(50000);
    expect(state.openings.filter((o) => o.sealed)).toHaveLength(2);
    expect(state.binder).toHaveLength(4); // sealed pack cards stay hidden
    expect(JSON.stringify(state)).not.toMatch(/"demo":|Demo Cardbits/); // no demo flag leaks to customers

    // Customer opens a pack and sells one card back with demo Cardbits in play.
    await storeAction(db, customer, { action: "reveal", requestId: randomUUID(), id: packs.openings[0] });
    state = await storeState(db, customer);
    const sell = state.binder.find((c) => c.openingId === packs.openings[0])!;
    await storeAction(db, customer, { action: "buyback", requestId: randomUUID(), id: sell.id, amount: 240 });
    expect(await balanceOf(db, customer.id)).toBe(50240);
    await postLedger(db, { customerId: customer.id, delta: 1000, kind: "TOPUP", idempotencyKey: "real-topup" });

    expect((await demoSummary(db)).copies).toBe(16);
    const wiped = await wipeDemo(db, "t");
    expect(wiped).toMatchObject({ copies: 16, openings: 2, bitsRemoved: 50240 });
    expect(await balanceOf(db, customer.id)).toBe(1000); // real top-up kept
    expect(await db.siteCopy.count()).toBe(2);
    expect(await db.siteOpening.count()).toBe(0);
    expect(await db.sitePrice.count()).toBe(1);
    expect((await wipeDemo(db, "t")).bitsRemoved).toBe(0); // second wipe is a no-op
  });
});
