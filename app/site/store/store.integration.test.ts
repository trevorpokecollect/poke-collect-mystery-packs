import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { balanceOf, postLedger } from "../core/ledger.server";
import { priceKey, receiveSiteIntake } from "../core/stock.server";
import { sitePortfolio } from "./portfolio.server";
import { DEFAULT_TIERS, drawCopies, recentPulls, singleKey, storeAction, storeState, StoreError, tierFor, tierRules } from "./store.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const card = (eventKey: string, quantity: number, name: string) => ({
  eventKey, quantity, title: `${name} - 1/100`, game: "pokemon", setName: "Test Set", number: "1/100",
  name, finish: "Holofoil", language: "English", condition: "Near Mint",
});
const wipe = async () => {
  await db.siteRequest.deleteMany();
  await db.siteWant.deleteMany();
  await db.siteOpening.deleteMany();
  await db.sitePrice.deleteMany();
  await db.siteCopyEvent.deleteMany();
  await db.siteCopy.deleteMany();
  await db.siteIntakeReceipt.deleteMany();
  await db.siteLedger.deleteMany();
  await db.siteWallet.deleteMany();
  await db.cardbitVaultMark.deleteMany({ where: { shop: "cardbit-site" } });
  await db.siteCustomer.deleteMany({ where: { email: { endsWith: "@store.test" } } });
};

describe("draw", () => {
  it("draws distinct items", () => {
    const d = drawCopies([1, 2, 3, 4, 5], 5);
    expect(new Set(d).size).toBe(5);
  });
});

describe("tiers", () => {
  it("maps value to the ladder, falls back to default rules", () => {
    expect(tierFor(null)).toBeNull();
    expect(tierFor(0)).toBe("Common");
    expect(tierFor(1500)).toBe("Rare");
    expect(tierFor(20000)).toBe("Legendary");
    expect(tierRules("junk")).toBe(DEFAULT_TIERS);
    expect(tierFor(300, tierRules([{ name: "Hit", min: 200 }, { name: "Base", min: 0 }]))).toBe("Hit");
  });
});

describe.skipIf(!url)("site store", () => {
  let customer: Awaited<ReturnType<typeof db.siteCustomer.create>>;
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(async () => {
    await wipe();
    customer = await db.siteCustomer.create({ data: { email: "c@store.test" } });
    await postLedger(db, { customerId: customer.id, delta: 5000, kind: "ADJUST", idempotencyKey: `seed:${customer.id}` });
  });
  afterAll(async () => {
    await wipe();
    await db.sitePack.updateMany({ data: { active: false, tierRules: undefined } });
    await db.$disconnect();
  });

  it("sells a priced single once, lists stock grouped by printing", async () => {
    await receiveSiteIntake(db, card("st:1", 2, "Pikachu"));
    const first = await db.siteCopy.findFirstOrThrow();
    const copy = priceKey(first.printingKey, first.condition);
    let state = await storeState(db, null);
    expect(state.singles).toHaveLength(0); // unpriced stays hidden
    await db.sitePrice.create({ data: { printingKey: copy, retailBits: 300, buybackBits: 200 } });
    state = await storeState(db, customer);
    expect(state.singles).toHaveLength(1);
    expect(state.singles[0]).toMatchObject({ available: 2, priceBits: 300, retailBits: 300, buybackBits: 200 });
    const requestId = randomUUID();
    const r = await storeAction(db, customer, { action: "buy", requestId, id: state.singles[0].id });
    expect(await storeAction(db, customer, { action: "buy", requestId, id: state.singles[0].id })).toEqual(r);
    expect(await balanceOf(db, customer.id)).toBe(4700);
    state = await storeState(db, customer);
    expect(state.singles[0].available).toBe(1);
    expect(state.binder).toHaveLength(1);
    expect(state.binder[0]).toMatchObject({ status: "held", buybackBits: 200 });

    // buyback must match the shown offer, then the copy goes back on sale
    await expect(storeAction(db, customer, { action: "buyback", requestId: randomUUID(), id: String(r.copyId), amount: 150 })).rejects.toThrow(StoreError);
    await storeAction(db, customer, { action: "buyback", requestId: randomUUID(), id: String(r.copyId), amount: 200 });
    expect(await balanceOf(db, customer.id)).toBe(4900);
    state = await storeState(db, customer);
    expect(state.singles[0].available).toBe(2);
    expect(state.binder).toHaveLength(0);
  });

  it("opens packs from the pool without double-selling, sealed until revealed", async () => {
    await receiveSiteIntake(db, card("st:2", 3, "Eevee"));
    await db.siteCopy.updateMany({ data: { status: "POOLED", packId: "cobalt" } });
    await db.sitePack.update({ where: { id: "cobalt" }, data: { active: true, priceBits: 1000, cardsPerPack: 1 } });
    const results = await Promise.allSettled(
      [1, 2, 3, 4].map(() => storeAction(db, customer, { action: "open", requestId: randomUUID(), id: "cobalt", openLater: true })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await balanceOf(db, customer.id)).toBe(2000);
    let state = await storeState(db, customer);
    expect(state.packs.find((p) => p.id === "cobalt")?.remaining).toBe(0);
    expect(state.binder).toHaveLength(0); // sealed
    const sealed = state.openings[0];
    expect(sealed).toMatchObject({ sealed: true, cards: [], cardCount: 1 });
    await storeAction(db, customer, { action: "reveal", requestId: randomUUID(), id: sealed.id });
    state = await storeState(db, customer);
    expect(state.binder).toHaveLength(1);
    expect(state.openings.find((o) => o.id === sealed.id)?.cards).toHaveLength(1);
  });

  it("takes Card Broker's price from the receipt, per condition", async () => {
    await receiveSiteIntake(db, { ...card("st:4", 1, "Abra"), priceBits: 250, buybackBits: 200 });
    await receiveSiteIntake(db, { ...card("st:5", 1, "Abra"), condition: "Lightly Played", priceBits: 180, buybackBits: 144 });
    const s = await storeState(db, null);
    expect(s.singles.map((x) => [x.condition, x.priceBits, x.buybackBits]).sort()).toEqual([["Lightly Played", 180, 144], ["Near Mint", 250, 200]]);
    await expect(receiveSiteIntake(db, { ...card("st:6", 1, "Abra"), priceBits: 100, buybackBits: 200 })).rejects.toThrow();
  });

  it("rejects spending without enough Cardbits and on frozen accounts", async () => {
    await receiveSiteIntake(db, card("st:3", 1, "Mew"));
    const c = await db.siteCopy.findFirstOrThrow();
    await db.sitePrice.create({ data: { printingKey: priceKey(c.printingKey, c.condition), retailBits: 9000 } });
    await expect(storeAction(db, customer, { action: "buy", requestId: randomUUID(), id: singleKey(c) })).rejects.toMatchObject({ code: "insufficient_bits" });
    const frozen = await db.siteCustomer.update({ where: { id: customer.id }, data: { frozenAt: new Date() } });
    await expect(storeAction(db, frozen, { action: "buy", requestId: randomUUID(), id: singleKey(c) })).rejects.toMatchObject({ code: "account_frozen" });
    expect((await db.siteCopy.findFirstOrThrow()).status).toBe("FOR_SALE");
  });

  it("Live Pulls lists revealed paid pulls only, with pack tiers", async () => {
    await receiveSiteIntake(db, { ...card("st:7", 2, "Snorlax"), priceBits: 2000, buybackBits: 1600 });
    await db.siteCopy.updateMany({ data: { status: "POOLED", packId: "cobalt" } });
    await db.sitePack.update({ where: { id: "cobalt" }, data: { active: true, priceBits: 1000, cardsPerPack: 1 } });
    await storeAction(db, customer, { action: "open", requestId: randomUUID(), id: "cobalt", openLater: true });
    expect(await recentPulls(db)).toHaveLength(0); // sealed stays hidden
    const r = await storeAction(db, customer, { action: "open", requestId: randomUUID(), id: "cobalt" });
    let pulls = await recentPulls(db);
    expect(pulls).toHaveLength(1);
    expect(pulls[0]).toMatchObject({ name: "Snorlax", packId: "cobalt", tier: "Rare" });
    expect(Object.keys(pulls[0]).sort()).toEqual(["at", "id", "image", "name", "number", "packId", "set", "tier"]);
    const state = await storeState(db, customer);
    expect(state.binder[0].tier).toBe("Rare");
    await db.siteOpening.updateMany({ data: { demo: true } });
    expect(await recentPulls(db)).toHaveLength(0); // demo never shows
    expect(r).toBeTruthy();
  });

  it("portfolio: held copies grouped by identity key, buyback bits, market only when approved", async () => {
    await receiveSiteIntake(db, { ...card("st:8", 2, "Gengar"), priceBits: 900, buybackBits: 700 });
    await db.siteCopy.updateMany({ data: { status: "VAULTED", ownerId: customer.id, tcgplayerId: 4242, language: "English", finish: "Holofoil", condition: "Near Mint" } });
    const key = "4242|en|holofoil|near mint";
    const market = async () => ({ [key]: [["2026-11-24", 1234]] as [string, number][] });
    delete process.env.CARDBIT_TCGPLAYER_MARKET_APPROVED;
    let p = await sitePortfolio(db, customer.id, market);
    expect(p).toMatchObject({ count: 2, bits: 1400, market: null, marketApproved: false, marketHistory: null });
    expect(p.holdings).toEqual([expect.objectContaining({ key, name: "Gengar", qty: 2, bits: 700, market: null })]);
    process.env.CARDBIT_TCGPLAYER_MARKET_APPROVED = "true";
    try {
      p = await sitePortfolio(db, customer.id, market);
    } finally {
      delete process.env.CARDBIT_TCGPLAYER_MARKET_APPROVED;
    }
    expect(p).toMatchObject({ market: 2468, marketApproved: true });
    expect(p.holdings[0]).toMatchObject({ market: 1234, marketDate: "2026-11-24" });
    expect(p.history).toHaveLength(1);
  });
});
