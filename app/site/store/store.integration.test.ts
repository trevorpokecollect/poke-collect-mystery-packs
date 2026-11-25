import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { balanceOf, postLedger } from "../core/ledger.server";
import { priceKey, receiveSiteIntake } from "../core/stock.server";
import { sitePortfolio } from "./portfolio.server";
import { giveDemoPacks, wipeDemo } from "../core/demo.server";
import { confirmAge } from "../../lib/cardbit-age.server";
import { setLimit, startCoolOff } from "../play/limits.server";
import { fairDraw, fairView, rotateSeed, setClientSeed, sha256 } from "../play/fair.server";
import { DEFAULT_TIERS, drawCopies, recentPulls, singleKey, storeAction, storeState, StoreError, tierFor, tierRules } from "./store.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const card = (eventKey: string, quantity: number, name: string) => ({
  eventKey, quantity, title: `${name} - 1/100`, game: "pokemon", setName: "Test Set", number: "1/100",
  name, finish: "Holofoil", language: "English", condition: "Near Mint",
});
const wipe = async () => {
  await db.siteRequest.deleteMany();
  await db.siteOpeningFair.deleteMany();
  await db.siteFairSeed.deleteMany();
  await db.sitePlayEvent.deleteMany();
  await db.sitePlayControl.deleteMany();
  await db.siteWant.deleteMany();
  await db.siteOpening.deleteMany();
  await db.sitePrice.deleteMany();
  await db.siteCopyEvent.deleteMany();
  await db.siteRestock.deleteMany();
  await db.siteCopy.deleteMany();
  await db.siteIntakeReceipt.deleteMany();
  await db.siteLedger.deleteMany();
  await db.siteWallet.deleteMany();
  await db.cardbitVaultMark.deleteMany({ where: { shop: "cardbit-site" } });
  await db.cardbitAgeConfirmation.deleteMany({ where: { shop: "cardbit-site" } });
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
    await confirmAge(db, "cardbit-site", customer.id, "signup");
  });
  afterAll(async () => {
    await wipe();
    await db.sitePack.updateMany({ data: { active: false, tierRules: undefined } });
    await db.$disconnect();
  });

  it("sells a priced single once, lists stock grouped by printing", async () => {
    await receiveSiteIntake(db, card("st:1", 2, "Pikachu"));
    expect(await db.siteCopy.count({ where: { status: "DRAFT" } })).toBe(2); // new stock lands in Draft
    await db.siteCopy.updateMany({ where: { status: "DRAFT" }, data: { status: "FOR_SALE" } }); // Make Active
    const first = await db.siteCopy.findFirstOrThrow();
    const copy = priceKey(first.printingKey, first.condition);
    let state = await storeState(db, null);
    expect(state.singles).toHaveLength(0); // unpriced stays hidden
    await db.sitePrice.create({ data: { printingKey: copy, retailBits: 300, buybackBits: 200 } });
    state = await storeState(db, customer);
    expect(state.singles).toHaveLength(1);
    expect(state.singles[0]).toMatchObject({ available: 2, tier: null, priceBits: 300, retailBits: 300, buybackBits: 200 });
    const requestId = randomUUID();
    const r = await storeAction(db, customer, { action: "buy", requestId, id: state.singles[0].id });
    expect(await storeAction(db, customer, { action: "buy", requestId, id: state.singles[0].id })).toEqual(r);
    expect(await balanceOf(db, customer.id)).toBe(4700);
    state = await storeState(db, customer);
    expect(state.singles[0].available).toBe(1);
    expect(state.binder).toHaveLength(1);
    expect(state.binder[0]).toMatchObject({ status: "held", tier: null, buybackBits: 200 });

    // buyback must match the shown offer, then the copy goes to Draft for the hourly automatic restock
    await expect(storeAction(db, customer, { action: "buyback", requestId: randomUUID(), id: String(r.copyId), amount: 150 })).rejects.toThrow(StoreError);
    await storeAction(db, customer, { action: "buyback", requestId: randomUUID(), id: String(r.copyId), amount: 200 });
    expect(await balanceOf(db, customer.id)).toBe(4900);
    state = await storeState(db, customer);
    expect(state.singles[0].available).toBe(1);
    expect(await db.siteCopy.findUniqueOrThrow({ where: { id: String(r.copyId) } })).toMatchObject({ status: "DRAFT", ownerId: null, autoRestock: true });
    expect(state.binder).toHaveLength(0);
  });

  it("enforces Spend Limits (packs and singles) and cool-offs on open and buy, but not on buyback", async () => {
    await receiveSiteIntake(db, card("st:pl", 3, "Snorlax"));
    await db.siteCopy.updateMany({ data: { status: "POOLED", packId: "cobalt" } });
    await db.sitePack.update({ where: { id: "cobalt" }, data: { active: true, priceBits: 1000, cardsPerPack: 1 } });
    await setLimit(db, customer.id, "spend:day", 1500);
    await storeAction(db, customer, { action: "open", requestId: randomUUID(), id: "cobalt" });
    await expect(storeAction(db, customer, { action: "open", requestId: randomUUID(), id: "cobalt" })).rejects.toMatchObject({ code: "limit_reached", status: 403 });
    expect(await balanceOf(db, customer.id)).toBe(4000);
    // Singles count toward the same Spend Limit (1,000 used of 1,500).
    await receiveSiteIntake(db, card("st:ps", 1, "Eevee"));
    await db.siteCopy.updateMany({ where: { status: "DRAFT" }, data: { status: "FOR_SALE" } }); // Make Active
    const single = await db.siteCopy.findFirstOrThrow({ where: { status: "FOR_SALE" } });
    await db.sitePrice.create({ data: { printingKey: priceKey(single.printingKey, single.condition), retailBits: 600 } });
    await expect(storeAction(db, customer, { action: "buy", requestId: randomUUID(), id: singleKey(single) })).rejects.toMatchObject({ code: "limit_reached" });
    await db.sitePrice.updateMany({ where: { printingKey: priceKey(single.printingKey, single.condition) }, data: { retailBits: 400 } });
    await storeAction(db, customer, { action: "buy", requestId: randomUUID(), id: singleKey(single) });
    const done = randomUUID();
    await setLimit(db, customer.id, "spend:day", 1_000_000).catch(() => undefined);
    await startCoolOff(db, customer.id, 24);
    await expect(storeAction(db, customer, { action: "buy", requestId: done, id: "s_x" })).rejects.toMatchObject({ code: "play_paused" });
    const state = await storeState(db, customer);
    expect(state.account?.play.paused?.kind).toBe("cool_off");
  });

  it("records a verifiable draw for each opening and reveals the seed on rotate", async () => {
    await receiveSiteIntake(db, card("st:vs", 6, "Mew"));
    await db.siteCopy.updateMany({ data: { status: "POOLED", packId: "cobalt" } });
    await db.sitePack.update({ where: { id: "cobalt" }, data: { active: true, priceBits: 500, cardsPerPack: 2 } });
    await setClientSeed(db, customer.id, "my-lucky-seed");
    const before = await fairView(db, customer.id);
    const a = await storeAction(db, customer, { action: "open", requestId: randomUUID(), id: "cobalt" });
    await storeAction(db, customer, { action: "open", requestId: randomUUID(), id: "cobalt" });
    let v = await fairView(db, customer.id);
    expect(v.active.nonce).toBe(2);
    const first = v.openings.find((o) => o.openingId === a.openingId)!;
    expect(first).toMatchObject({ nonce: 0, clientSeed: "my-lucky-seed", serverSeedHash: before.active.serverSeedHash, serverSeed: null });
    expect(first.poolIds).toHaveLength(6);
    const owned = await db.siteCopy.findMany({ where: { openingId: String(a.openingId) } });
    expect(new Set(first.pickIds)).toEqual(new Set(owned.map((c) => c.id)));
    await rotateSeed(db, customer.id);
    v = await fairView(db, customer.id);
    const revealed = v.openings.find((o) => o.openingId === a.openingId)!;
    expect(sha256(revealed.serverSeed!)).toBe(revealed.serverSeedHash);
    expect(fairDraw(revealed.poolIds, 2, revealed.serverSeed!, revealed.clientSeed, revealed.nonce)).toEqual(revealed.pickIds);
    expect(v.active.serverSeedHash).not.toBe(before.active.serverSeedHash);
    expect(v.active.nonce).toBe(0);
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
    await db.siteCopy.updateMany({ where: { status: "DRAFT" }, data: { status: "FOR_SALE" } }); // Make Active
    const s = await storeState(db, null);
    expect(s.singles.map((x) => [x.condition, x.priceBits, x.buybackBits]).sort()).toEqual([["Lightly Played", 180, 144], ["Near Mint", 250, 200]]);
    await expect(receiveSiteIntake(db, { ...card("st:6", 1, "Abra"), priceBits: 100, buybackBits: 200 })).rejects.toThrow();
  });

  it("rejects spending without enough Cardbits and on frozen accounts", async () => {
    await receiveSiteIntake(db, card("st:3", 1, "Mew"));
    await db.siteCopy.updateMany({ where: { status: "DRAFT" }, data: { status: "FOR_SALE" } }); // Make Active
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
    expect(state.binder[0].tier).toBeNull(); // tiers stay in the pools
    expect(state.openings[0].cards[0].tier).toBe("Rare");
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

  it("requires an 18+ confirmation before buying packs or singles", async () => {
    await db.cardbitAgeConfirmation.deleteMany({ where: { shop: "cardbit-site" } });
    await expect(storeAction(db, customer, { action: "open", requestId: randomUUID(), id: "cobalt" })).rejects.toMatchObject({ code: "AGE_REQUIRED", status: 403 });
    await expect(storeAction(db, customer, { action: "buy", requestId: randomUUID(), id: "s_x" })).rejects.toMatchObject({ code: "AGE_REQUIRED" });
    expect(await balanceOf(db, customer.id)).toBe(5000);
  });

  it("awards Sparks once per paid opening when site Sparks are on", async () => {
    await receiveSiteIntake(db, { ...card("st:9", 1, "Ditto"), priceBits: 300, buybackBits: 200 });
    await db.siteCopy.updateMany({ data: { status: "POOLED", packId: "cobalt" } });
    await db.sitePack.update({ where: { id: "cobalt" }, data: { active: true, priceBits: 1000, cardsPerPack: 1 } });
    const env = { CARDBIT_SITE: process.env.CARDBIT_SITE, CARDBIT_SPARKS: process.env.CARDBIT_SPARKS };
    process.env.CARDBIT_SITE = "on";
    process.env.CARDBIT_SPARKS = "on";
    try {
      const requestId = randomUUID();
      const r = await storeAction(db, customer, { action: "open", requestId, id: "cobalt" });
      await storeAction(db, customer, { action: "open", requestId, id: "cobalt" });
      const txns = await db.cardbitSparkTxn.findMany({ where: { shop: "cardbit-site", customerId: customer.id } });
      expect(txns).toHaveLength(1);
      expect(txns[0]).toMatchObject({ eventKey: `spark:site-open:${r.openingId}`, delta: 40 });
      expect(r.rewards).toMatchObject({ sparks: 40 });
      const state = await storeState(db, customer);
      expect(state.account).toMatchObject({ sparks: 40 });
      expect(state.openings.find((o) => o.id === r.openingId)?.rewards).toMatchObject({ sparks: 40 });
    } finally {
      for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
      await db.cardbitSparkTxn.deleteMany({ where: { shop: "cardbit-site" } });
      await db.cardbitSparkWallet.deleteMany({ where: { shop: "cardbit-site" } });
    }
  });

  it("returns XP on the reveal; demo packs earn at list price on reveal and Wipe Demo takes it back", async () => {
    await receiveSiteIntake(db, { ...card("st:10", 1, "Eevee"), priceBits: 300, buybackBits: 200 });
    await receiveSiteIntake(db, { ...card("st:11", 2, "Snorlax"), priceBits: 300, buybackBits: 200 });
    await db.siteCopy.updateMany({ data: { status: "POOLED", packId: "cobalt" } });
    await db.sitePack.update({ where: { id: "cobalt" }, data: { active: true, priceBits: 1000, cardsPerPack: 1 } });
    const env = { CARDBIT_SITE: process.env.CARDBIT_SITE, CARDBIT_LEVELS: process.env.CARDBIT_LEVELS, CARDBIT_SPARKS: process.env.CARDBIT_SPARKS };
    process.env.CARDBIT_SITE = "on";
    process.env.CARDBIT_LEVELS = "on";
    process.env.CARDBIT_SPARKS = "on";
    try {
      const paid = await storeAction(db, customer, { action: "open", requestId: randomUUID(), id: "cobalt" });
      expect(paid.rewards).toEqual({ xp: 20, sparks: 40 }); // 2 XP per 100 Cardbits; 5% of the 800 gap
      // A staff demo pack: no charge, earns on reveal, once.
      await db.siteCopy.updateMany({ where: { status: "POOLED" }, data: { demo: true } });
      await giveDemoPacks(db, "staff:test", customer.email, "cobalt", 1);
      const sealed = await db.siteOpening.findFirstOrThrow({ where: { demo: true, sealed: true } });
      const r1 = await storeAction(db, customer, { action: "reveal", requestId: randomUUID(), id: sealed.id });
      const r2 = await storeAction(db, customer, { action: "reveal", requestId: randomUUID(), id: sealed.id });
      expect(r1.rewards).toEqual({ xp: 20, sparks: 40 });
      expect(r2.rewards).toEqual({ xp: 20, sparks: 40 });
      const state = await storeState(db, customer);
      expect(state.account).toMatchObject({ sparks: 80, level: { xp: 40, level: 2 } });
      await wipeDemo(db, "staff:test");
      const after = await storeState(db, customer);
      expect(after.account).toMatchObject({ sparks: 40, level: { xp: 20 } });
    } finally {
      for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
      for (const t of [db.cardbitSparkTxn, db.cardbitSparkWallet, db.cardbitXpEvent, db.cardbitProfile] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }[])
        await t.deleteMany({ where: { shop: "cardbit-site" } });
    }
  });
});
