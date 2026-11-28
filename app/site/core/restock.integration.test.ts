import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { postLedger } from "./ledger.server";
import { priceKey, receiveSiteIntake } from "./stock.server";
import { DeskError, fixPooledCopy, movePool, setListing } from "./stock-desk.server";
import { confirmAge } from "../../lib/cardbit-age.server";
import { storeAction, storeState } from "../store/store.server";
import { EV_CEILING, evBand, loopMarginPct, planRebalance, reshufflePack, autoStageDrafts, publishAllStaged, eligible, eraOf, evPct, poolHashOf, poolVersion, publishRestock, restockHistory, routeCard, runAutoRestock, trimToBand, savePackEv, stageRestock, stagedRestocks, unstageRestock, RestockError, ruleBreak, capBreak, typeCounts, type PoolState } from "./restock.server";
import { autoTierRules } from "../store/tiers";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
let seq = 0;
const card = (eventKey: string, quantity: number, name: string, extra: Record<string, unknown> = {}) => ({
  eventKey, quantity, title: `${name} - 1/100`, game: "pokemon", setName: "Restock Set", number: `${++seq}/100`,
  name, finish: "Holofoil", language: "English", condition: "Near Mint", ...extra,
});
const wipe = async () => {
  await db.siteRequest.deleteMany();
  await db.siteOpeningFair.deleteMany();
  await db.siteFairSeed.deleteMany();
  await db.siteOpening.deleteMany();
  await db.sitePrice.deleteMany();
  await db.siteCopyEvent.deleteMany();
  await db.siteRestock.deleteMany();
  await db.siteCopy.deleteMany();
  await db.siteIntakeReceipt.deleteMany();
  await db.siteLedger.deleteMany();
  await db.siteWallet.deleteMany();
  await db.appValue.deleteMany({ where: { key: "cardbit-site:auto-restock" } });
  await db.cardbitAgeConfirmation.deleteMany({ where: { shop: "cardbit-site" } });
  await db.siteCustomer.deleteMany({ where: { email: { endsWith: "@restock.test" } } });
  await db.sitePack.updateMany({
    data: { active: false, targetEvPct: null, evBandPct: 5, minTopPer100: null, minValueBits: null, maxValueBits: null, typeCaps: Prisma.DbNull, tierMix: Prisma.DbNull, topTierMin: null, tiersAt: null, autoDrafts: false },
  });
  // Put back the seeded tier ladders (auto tiers rewrite them) so other suites see the same packs.
  for (const [id, rules, languages, eras, cardsPerPack] of ladders)
    await db.sitePack.update({ where: { id }, data: { tierRules: rules ?? Prisma.DbNull, languages: languages ?? Prisma.DbNull, eras: eras ?? Prisma.DbNull, cardsPerPack } });
};
let ladders: [string, Prisma.JsonValue, Prisma.JsonValue, Prisma.JsonValue, number][] = [];
/** n Draft copies of one printing at a Poke-Collect retail (and 80% buyback). */
async function stock(key: string, n: number, retail: number, extra: Record<string, unknown> = {}) {
  await receiveSiteIntake(db, { ...card(key, n, key, extra), priceBits: retail, buybackBits: Math.round(retail * 0.8) });
  return db.siteCopy.findMany({ where: { name: key }, orderBy: { id: "asc" } });
}

describe("restock helpers", () => {
  it("computes EV, eras, eligibility and the pool hash rule", () => {
    expect(evPct(11_000, 10, { cardsPerPack: 1, priceBits: 1000 })).toBe(110);
    expect(evPct(6_495, 25, { cardsPerPack: 5, priceBits: 1299 })).toBe(100);
    expect(evPct(0, 0, { cardsPerPack: 1, priceBits: 1000 })).toBeNull();
    expect(eraOf({ era: null, setName: "Base Set" })).toBe("Vintage");
    expect(eraOf({ era: null, setName: "Neo Genesis" })).toBe("Vintage");
    expect(eraOf({ era: null, setName: "Scarlet & Violet" })).toBe("Modern");
    expect(eraOf({ era: "Vintage", setName: "Scarlet & Violet" })).toBe("Vintage");
    const mystery = { languages: ["English"], eras: ["Modern"] };
    expect(eligible(mystery, { language: "English", era: null, setName: "Paldea Evolved" })).toBe(true);
    expect(eligible(mystery, { language: "Japanese", era: null, setName: "Paldea Evolved" })).toBe(false);
    expect(eligible(mystery, { language: "English", era: null, setName: "Jungle" })).toBe(false);
    expect(eligible({ languages: null, eras: null }, { language: "Japanese", era: null, setName: "Jungle" })).toBe(true);
    expect(poolHashOf(["b", "a"])).toBe(poolHashOf(["a", "b"]));
  });

  it("routes a card to the eligible pool it moves toward target EV, never out of band", () => {
    const pack = (id: string, target: number | null, extra = {}) => ({
      id, title: id, priceBits: 1000, cardsPerPack: 1, active: true, sortOrder: 0, tierRules: null, createdAt: new Date(), updatedAt: new Date(),
      targetEvPct: target, evBandPct: 5, minTopPer100: null, languages: null, eras: null,
      minValueBits: null as number | null, maxValueBits: null as number | null, typeCaps: null as unknown, tierMix: null, topTierMin: null, tiersAt: null, ...extra,
    }) as unknown as PoolState["pack"];
    const st = (p: PoolState["pack"], cards: number, retail: number): PoolState => ({ pack: p, cards, retail, top: 0, topTier: "Legendary" });
    const english = { language: "English", era: null, setName: "Modern Set" };
    // low: 10 cards worth 9,000 → EV 90 (target 100). high: EV 104 (target 100).
    const low = st(pack("low", 100), 10, 9_000);
    const high = st(pack("high", 100), 10, 10_400);
    expect(routeCard(2_000, english, [low, high])?.pack.id).toBe("low"); // 100.0 → closes the gap
    expect(routeCard(5_000, english, [high])).toBeNull(); // would push it to 140
    expect(routeCard(2_000, english, [st(pack("off", null), 10, 9_000)])).toBeNull(); // no target set
    expect(routeCard(2_000, { ...english, language: "Japanese" }, [st(pack("en", 100, { languages: ["English"] }), 10, 9_000)])).toBeNull();
  });
});

describe("pool rules and auto tiers", () => {
  it("ranks tiers by value on the fixed mix, always keeps a top tier, and honours a top-tier minimum", () => {
    const vals = Array.from({ length: 100 }, (_, i) => (i + 1) * 100); // 100 … 10,000
    const { rules, topShort } = autoTierRules(vals);
    expect(rules.map((r) => r.name)).toEqual(["Common", "Uncommon", "Rare", "Epic", "Legendary"]);
    // Top 2 → Legendary (≥ 9,900), next 8 → Epic (≥ 9,100), next 15 → Rare (≥ 7,600), next 25 → Uncommon (≥ 5,100).
    expect(rules.map((r) => r.min)).toEqual([0, 5_100, 7_600, 9_100, 9_900]);
    expect(topShort).toBe(false);
    // Tiny pool: still exactly one Legendary.
    expect(autoTierRules([100, 200, 300]).rules.at(-1)).toEqual({ name: "Legendary", min: 300 });
    // Top-tier minimum nobody reaches: flagged, cutoff held at the minimum.
    const short = autoTierRules([100, 200, 300], undefined, 5_000);
    expect(short.topShort).toBe(true);
    expect(short.rules.at(-1)).toEqual({ name: "Legendary", min: 5_000 });
    // Empty pool: only the base tier (callers keep the old cutoffs).
    expect(autoTierRules([]).cards).toBe(0);
  });

  it("checks value range, eligibility and max % per card type", () => {
    const pack = { languages: ["English", "Japanese"], eras: null, minValueBits: 200, maxValueBits: 5_000, typeCaps: { Japanese: 30 } };
    const en = { language: "English", era: null, setName: "Paldea" };
    const jp = { language: "Japanese", era: null, setName: "Paldea" };
    expect(ruleBreak(pack, en, 1_000)).toBeNull();
    expect(ruleBreak(pack, en, 100)).toMatch(/Below/);
    expect(ruleBreak(pack, en, 6_000)).toMatch(/Above/);
    expect(ruleBreak(pack, en, null)).toMatch(/No price/);
    const mix = typeCounts([en, en, jp]);
    expect(mix).toMatchObject({ English: 2, Japanese: 1, Modern: 3 });
    expect(capBreak(pack, { ...mix, Japanese: 2 }, 4)).toMatch(/Japanese cards would be more than 30%/);
    expect(capBreak(pack, { ...mix, Japanese: 2 }, 7)).toBeNull();
  });
});

describe("buyback-loop margin", () => {
  const rc = (id: string, v: number, key = id) => ({ id, v, key, language: "English", era: null, setName: "Modern Set" });
  const pk = (extra = {}) => ({
    id: "p", kind: "pack", targetEvPct: 109, evBandPct: 3, cardsPerPack: 1, priceBits: 1000, minTopPer100: null, tierRules: null,
    languages: null, eras: null, minValueBits: null, maxValueBits: null, typeCaps: null, ...extra,
  });
  it("margin = 100 − 0.8 × EV; no band reaches past 112.5% EV", () => {
    expect(EV_CEILING).toBe(112.5);
    expect(loopMarginPct(114)).toBe(8.8);
    expect(loopMarginPct(112.5)).toBe(10);
    expect(loopMarginPct(106.25)).toBe(15);
    expect(loopMarginPct(null)).toBeNull();
    // Booster today: 110 ± 5 would allow 115; the top is cut at 112.5.
    expect(evBand({ targetEvPct: 110, evBandPct: 5 })).toEqual({ lo: 105, hi: 112.5, aim: 110, capped: true });
    expect(evBand({ targetEvPct: 109, evBandPct: 3 })).toEqual({ lo: 106, hi: 112, aim: 109, capped: false });
    expect(evBand({ targetEvPct: null, evBandPct: 5 })).toBeNull();
  });
  it("plans adds first, removes only when adding can't help, and keeps the top tier", () => {
    // 10 cards worth 11,400 → EV 114 (margin 8.8%). Cheap Drafts bring it down without removing anything.
    const pool = [...Array.from({ length: 9 }, (_, i) => rc(`c${i}`, 1000)), rc("big", 2400)];
    const drafts = [rc("d1", 300), rc("d2", 200), rc("d3", 5000)];
    const a = planRebalance(pk(), pool, drafts, { allowRemove: true });
    expect(a.before).toBe(114);
    expect(a.removes).toEqual([]);
    expect(a.adds.map((c) => c.id)).toEqual(["d1"]);
    expect(a.after).toBeCloseTo(106.36, 1);
    expect(a.inBand).toBe(true);
    // No Drafts: add-only can't fix it; with removal allowed it takes out a card, never the only top-tier one.
    expect(planRebalance(pk(), pool, [], { allowRemove: false })).toMatchObject({ adds: [], removes: [], inBand: false });
    // Only taking out "big" (the only top-tier card) would lower EV, so it stays and the plan says it can't fix it.
    const ladder = { tierRules: [{ name: "Common", min: 0 }, { name: "Legendary", min: 2400 }] };
    expect(planRebalance(pk(ladder), pool, [], { allowRemove: true })).toMatchObject({ removes: [], inBand: false });
    // With a second high card, that one goes instead.
    // 18 × 1,000 + 2,600 + top-tier 3,000 = EV 118; taking out the 2,600 lands at 110.5.
    const pool2 = [...Array.from({ length: 18 }, (_, i) => rc(`m${i}`, 1000)), rc("hi2", 2600), rc("big", 3000)];
    const b = planRebalance(pk({ tierRules: [{ name: "Common", min: 0 }, { name: "Legendary", min: 3000 }] }), pool2, [], { allowRemove: true });
    expect(b.removes.map((c) => c.id)).toEqual(["hi2"]);
    expect(b.inBand).toBe(true);
    // Too low: a high-value Draft lifts it; Pool Rules still apply (max value blocks the 5,000).
    const low = Array.from({ length: 10 }, (_, i) => rc(`l${i}`, 900));
    const up = planRebalance(pk(), low, drafts, { allowRemove: false });
    expect(up.adds.map((c) => c.id)).toContain("d3");
    expect(up.removes).toEqual([]);
    expect(up.inBand).toBe(true);
    expect(planRebalance(pk({ maxValueBits: 4000 }), low, drafts, { allowRemove: false }).adds).toEqual([]);
    // Multi-card packs: at most one copy of a printing per pack's worth of cards.
    const booster = pk({ cardsPerPack: 5, priceBits: 5000 });
    const bpool = Array.from({ length: 10 }, (_, i) => rc(`b${i}`, 1200));
    const r = planRebalance(booster, bpool, Array.from({ length: 6 }, (_, i) => rc(`s${i}`, 100, "same")), { allowRemove: false });
    expect(r.adds.length).toBeLessThanOrEqual(2);
  });
});

describe.skipIf(!url)("verified restocks", () => {
  let customer: Awaited<ReturnType<typeof db.siteCustomer.create>>;
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeAll(async () => {
    if (!ladders.length) ladders = (await db.sitePack.findMany({ select: { id: true, tierRules: true, languages: true, eras: true, cardsPerPack: true } })).map((p) => [p.id, p.tierRules, p.languages, p.eras, p.cardsPerPack]);
  });
  beforeEach(async () => {
    await wipe();
    customer = await db.siteCustomer.create({ data: { email: "c@restock.test" } });
    await postLedger(db, { customerId: customer.id, delta: 100_000, kind: "ADJUST", idempotencyKey: `seed:${customer.id}` });
    await confirmAge(db, "cardbit-site", customer.id, "signup");
    await db.sitePack.update({ where: { id: "cobalt" }, data: { active: true } });
  });
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it("stages, locks and publishes versioned pools; openings record the version they drew from", async () => {
    const a = await stock("Alpha", 4, 500);
    const b = await stock("Beta", 2, 2000);
    // Starting pool: version 1 recorded on first publish.
    expect((await stageRestock(db, "staff:a", "cobalt", a.map((c) => c.id), "add")).staged).toBe(4);
    // A staged copy can't be staged again (same or other pack) or made active.
    expect((await stageRestock(db, "staff:b", "gold", [a[0].id], "add")).staged).toBe(0);
    expect(await setListing(db, "t", [a[0].id], true)).toEqual({ moved: 0, skipped: 1 });
    expect(await db.siteCopy.count({ where: { status: "POOLED" } })).toBe(0); // nothing live until publish

    const v2 = await publishRestock(db, "staff:a", "cobalt", "First cards");
    expect(v2).toMatchObject({ status: "LIVE", version: 2, poolSize: 4, note: "First cards", evPct: 50 });
    const v1 = await db.siteRestock.findFirstOrThrow({ where: { packId: "cobalt", version: 1 } });
    expect(v1).toMatchObject({ poolSize: 0, note: "Starting Pool" });
    expect(v2.poolHash).toBe(poolHashOf(a.map((c) => c.id)));
    await expect(publishRestock(db, "t", "cobalt")).rejects.toThrow(RestockError); // nothing staged

    // Open one pack: its fair record names version 2 and draws from that version's list.
    const r = await storeAction(db, customer, { action: "open", requestId: randomUUID(), id: "cobalt" });
    const fair = await db.siteOpeningFair.findUniqueOrThrow({ where: { openingId: String(r.openingId) } });
    expect(fair.poolVersion).toBe(2);
    expect(fair.poolIds).toEqual(v2.poolIds);

    // Add Beta, stage one Alpha to come out; the staged removal stays drawable until publish.
    await stageRestock(db, "t", "cobalt", b.map((c) => c.id), "add");
    const left = await db.siteCopy.findMany({ where: { status: "POOLED", packId: "cobalt" }, orderBy: { id: "asc" } });
    await movePool(db, "t", [left[0].id], null);
    expect((await db.siteCopy.findUniqueOrThrow({ where: { id: left[0].id } })).status).toBe("POOLED");
    const view = (await stagedRestocks(db)).find((p) => p.packId === "cobalt")!;
    expect(view).toMatchObject({ now: { cards: 3, evPct: 50 }, after: { cards: 4 } });
    expect(view.adds).toHaveLength(2);
    expect(view.removes).toHaveLength(1);
    await unstageRestock(db, "t", [b[1].id]);
    const v3 = await publishRestock(db, "t", "cobalt");
    expect(v3).toMatchObject({ version: 3, poolSize: 3 });
    expect(v3.addIds).toEqual([b[0].id]);
    expect(v3.removeIds).toEqual([left[0].id]);
    expect((await db.siteCopy.findUniqueOrThrow({ where: { id: b[1].id } })).status).toBe("DRAFT");

    // Public history (newest first) and the full list for the verifier.
    const hist = (await restockHistory(db, ["cobalt"])).get("cobalt")!;
    expect(hist.map((h) => [h.version, h.added, h.removed, h.poolSize])).toEqual([[3, 1, 1, 3], [2, 4, 0, 4], [1, 0, 0, 0]]);
    expect(hist[0]).not.toHaveProperty("evPct"); // EV is internal only
    const pv = await poolVersion(db, "cobalt", 3);
    expect(pv?.cards.map((c) => c.id)).toEqual(v3.poolIds);
    const state = await storeState(db, null);
    expect(state.packs.find((p) => p.id === "cobalt")?.restocks[0]).toMatchObject({ version: 3, poolSize: 3 });
    expect(JSON.stringify(state.packs)).not.toContain("evPct");
  });

  it("fixes or deletes a pooled card as its own correction version, never touching pulls or other staged cards", async () => {
    const a = await stock("Fixme", 5, 500);
    await stageRestock(db, "t", "cobalt", a.map((c) => c.id), "add");
    const v2 = await publishRestock(db, "t", "cobalt");
    // Someone else's staged removal and a staged add for later must survive the correction.
    const [extra] = await stock("Later", 1, 700);
    await stageRestock(db, "t", "cobalt", [extra.id], "add");
    await movePool(db, "t", [a[4].id], null);
    // One pack opened first: the pulled card is in a vault and can't be changed.
    const r = await storeAction(db, customer, { action: "open", requestId: randomUUID(), id: "cobalt" });
    const pulled = await db.siteCopy.findFirstOrThrow({ where: { openingId: String(r.openingId) } });
    await expect(fixPooledCopy(db, "t", { copyId: pulled.id, action: "delete", reason: "x" })).rejects.toThrow(/vault|isn't in a pack pool/);
    const pool = await db.siteCopy.findMany({ where: { packId: "cobalt", status: "POOLED", restockId: null }, orderBy: { id: "asc" } });
    await expect(fixPooledCopy(db, "t", { copyId: pool[0].id, action: "delete", reason: "" })).rejects.toThrow(DeskError);

    // Delete: v3 drops exactly that card (new hash), the card is REMOVED and out of its pocket.
    const del = await fixPooledCopy(db, "card-broker:emily", { copyId: pool[0].id, action: "delete", reason: "Listed twice" });
    expect(del).toMatchObject({ packId: "cobalt", version: 3, deleted: true });
    const v3 = await db.siteRestock.findFirstOrThrow({ where: { packId: "cobalt", version: 3 } });
    expect(v3.removeIds).toEqual([pool[0].id]);
    expect(v3.addIds).toEqual([]);
    expect(v3.note).toBe("Correction: Card Removed");
    expect(v3.poolHash).not.toBe(v2.poolHash);
    expect(v3.poolHash).toBe(poolHashOf(v3.poolIds as string[]));
    expect(await db.siteCopy.findUniqueOrThrow({ where: { id: pool[0].id } })).toMatchObject({ status: "REMOVED", packId: null, slot: null });
    // Other staged cards are untouched and the pulled card's stored opening is unchanged.
    expect((await db.siteCopy.findUniqueOrThrow({ where: { id: extra.id } })).restockId).not.toBeNull();
    if (a[4].id !== pulled.id) expect((await db.siteCopy.findUniqueOrThrow({ where: { id: a[4].id } })).restockId).not.toBeNull();
    expect(await db.siteCopy.findUniqueOrThrow({ where: { id: pulled.id } })).toMatchObject({ status: "VAULTED", openingId: pulled.openingId });

    // Change: switch condition on a copy already staged to leave (its staged removal is folded in).
    const staged = a[4].id === pulled.id ? pool[1].id : a[4].id;
    const sw = await fixPooledCopy(db, "t", { copyId: staged, action: "switch", reason: "Wrong condition", condition: "Lightly Played" });
    expect(sw).toMatchObject({ version: 4, switched: true, condition: "Lightly Played" });
    expect(await db.siteCopy.findUniqueOrThrow({ where: { id: staged } })).toMatchObject({ status: "DRAFT", packId: null, restockId: null, condition: "Lightly Played" });
    // Change with nothing to change is refused; a card no longer pooled is refused.
    const keep = (await db.siteCopy.findFirstOrThrow({ where: { packId: "cobalt", status: "POOLED", restockId: null } })).id;
    await expect(fixPooledCopy(db, "t", { copyId: keep, action: "switch", reason: "x" })).rejects.toThrow(/right card or condition/);
    await expect(fixPooledCopy(db, "t", { copyId: staged, action: "pull", reason: "x" })).rejects.toThrow(/isn't in a pack pool/);

    // Public history shows the corrections with no staff names or reasons.
    const hist = (await restockHistory(db, ["cobalt"])).get("cobalt")!;
    expect(hist.slice(0, 2).map((h) => [h.version, h.removed, h.note])).toEqual([[4, 1, "Correction: Card Taken Out To Fix"], [3, 1, "Correction: Card Removed"]]);
    expect(JSON.stringify(hist)).not.toContain("emily");
    // The next staged restock still publishes normally on top.
    expect(await publishRestock(db, "t", "cobalt")).toMatchObject({ version: 5, addIds: [extra.id] });
  });

  it("a pooled-card fix and a pack opening racing for the same pool never double-use a card", async () => {
    const a = await stock("Race", 1, 500);
    await stageRestock(db, "t", "cobalt", a.map((c) => c.id), "add");
    await publishRestock(db, "t", "cobalt");
    const [fix, open] = await Promise.allSettled([
      fixPooledCopy(db, "t", { copyId: a[0].id, action: "delete", reason: "Damaged" }),
      storeAction(db, customer, { action: "open", requestId: randomUUID(), id: "cobalt" }),
    ]);
    const c = await db.siteCopy.findUniqueOrThrow({ where: { id: a[0].id } });
    if (fix.status === "fulfilled") {
      expect(c.status).toBe("REMOVED");
      expect(open.status).toBe("rejected");
    } else {
      expect(c.status).toBe("VAULTED");
      expect(open.status).toBe("fulfilled");
    }
  });

  it("records the starting pool as version 1 when an opening comes first", async () => {
    const a = await stock("Solo", 2, 500);
    await db.siteCopy.updateMany({ where: { id: { in: a.map((c) => c.id) } }, data: { status: "POOLED", packId: "cobalt" } });
    const r = await storeAction(db, customer, { action: "open", requestId: randomUUID(), id: "cobalt" });
    expect((await db.siteOpeningFair.findUniqueOrThrow({ where: { openingId: String(r.openingId) } })).poolVersion).toBe(1);
    expect(await db.siteRestock.findFirstOrThrow({ where: { packId: "cobalt", version: 1 } })).toMatchObject({ poolSize: 2, poolHash: poolHashOf(a.map((c) => c.id)) });
  });

  it("concurrent staging of the last copy and concurrent publishes apply once", async () => {
    const [x] = await stock("Last", 1, 800);
    const res = await Promise.all([stageRestock(db, "s1", "cobalt", [x.id], "add"), stageRestock(db, "s2", "gold", [x.id], "add")]);
    expect(res.map((r) => r.staged).sort()).toEqual([0, 1]);
    const pack = res[0].staged ? "cobalt" : "gold";
    const pubs = await Promise.allSettled([publishRestock(db, "s1", pack), publishRestock(db, "s2", pack)]);
    expect(pubs.filter((p) => p.status === "fulfilled")).toHaveLength(1);
    expect(await db.siteRestock.count({ where: { packId: pack, status: "LIVE" } })).toBe(2); // starting pool + one
    expect(await db.siteCopy.count({ where: { status: "POOLED", packId: pack } })).toBe(1);
  });

  it("routes buybacks hourly to the pool that needs them, holds the rest, and publishes one logged restock", async () => {
    await savePackEv(db, "cobalt", { targetEvPct: 100, evBandPct: 5 }); // Mystery: Modern + English
    await expect(savePackEv(db, "cobalt", { targetEvPct: 5 })).rejects.toThrow(RestockError);
    // Pool: 10 cards worth 900 each → EV 90 against a 1,000 pack.
    const base = await stock("Base", 10, 900);
    await stageRestock(db, "t", "cobalt", base.map((c) => c.id), "add");
    await publishRestock(db, "t", "cobalt");
    // Customer owns a 2,000 Modern English card, a Japanese card and a Vintage card, and sells all back.
    const hit = await stock("Hit", 1, 2000);
    const jp = await stock("Jp", 1, 2000, { language: "Japanese" });
    const old = await stock("Old", 1, 2000, { setName: "Jungle" });
    const mine = [...hit, ...jp, ...old];
    await db.siteCopy.updateMany({ where: { id: { in: mine.map((c) => c.id) } }, data: { status: "VAULTED", ownerId: customer.id } });
    for (const c of mine) await storeAction(db, customer, { action: "buyback", requestId: randomUUID(), id: c.id, amount: 1600 });
    expect(await db.siteCopy.count({ where: { autoRestock: true, status: "DRAFT" } })).toBe(3);

    const run = await runAutoRestock(db);
    expect(run).toMatchObject({ ran: true, routed: 1, held: 2, versions: [{ packId: "cobalt", version: 3 }] });
    const v3 = await db.siteRestock.findFirstOrThrow({ where: { packId: "cobalt", version: 3 } });
    expect(v3).toMatchObject({ auto: true, actor: "auto-restock", note: "Buyback Restock", addIds: [hit[0].id] });
    expect(v3.evPct).toBe(100); // (9,000 + 2,000) / 11 cards / 1,000
    // Japanese + Vintage don't fit Mystery and no other pack has a target: they wait in Draft.
    expect(await db.siteCopy.count({ where: { autoRestock: true, status: "DRAFT" } })).toBe(2);
    // Once an hour: a second run right away does nothing.
    expect((await runAutoRestock(db)).ran).toBe(false);
    // Staff Make Active takes a waiting buyback out of the automatic queue.
    await setListing(db, "t", [jp[0].id], true);
    expect((await db.siteCopy.findUniqueOrThrow({ where: { id: jp[0].id } })).autoRestock).toBe(false);
    // Gold (any language/era) gets a target → the Vintage card routes there next hour.
    await db.sitePack.update({ where: { id: "gold" }, data: { targetEvPct: 100, evBandPct: 10 } });
    const later = await runAutoRestock(db, { now: new Date(Date.now() + 61 * 60_000) });
    expect(later.versions.map((v) => v.packId)).toEqual(["gold"]);
    expect((await db.siteCopy.findUniqueOrThrow({ where: { id: old[0].id } })).packId).toBe("gold");
  });

  it("trims an auto batch so a pool ends inside its EV band", () => {
    const pack = { targetEvPct: 100, evBandPct: 5, cardsPerPack: 1, priceBits: 1000 };
    const vs = (xs: number[]) => xs.map((v) => ({ v }));
    // Empty pool, one big card: 405% EV, so nothing is added.
    expect(trimToBand(pack, { cards: 0, retail: 0 }, vs([4050]))).toEqual([]);
    // Empty pool: too high → drop the 5,000; then too low → drop the cheapest until EV is in band.
    expect(trimToBand(pack, { cards: 0, retail: 0 }, vs([5000, 1000, 1000, 900, 800, 300])).map((x) => x.v)).toEqual([1000, 1000, 900]);
    // Too low: drop the cheapest.
    expect(trimToBand(pack, { cards: 0, retail: 0 }, vs([1000, 1000, 100])).map((x) => x.v)).toEqual([1000, 1000]);
    // A pool that already has cards keeps a batch that moves it closer to target, even if still outside the band.
    expect(trimToBand(pack, { cards: 10, retail: 20_000 }, vs([500])).map((x) => x.v)).toEqual([500]);
    expect(trimToBand({ ...pack, targetEvPct: null }, { cards: 0, retail: 0 }, vs([1000]))).toEqual([]);
  });

  it("Auto-Fill From Drafts pools listed Drafts only for switched-on packs, after the hold, one pool per card", async () => {
    // Needs a Target EV; off by default; clearing the target turns it off.
    await expect(savePackEv(db, "cobalt", { autoDrafts: true })).rejects.toThrow(RestockError);
    await savePackEv(db, "cobalt", { targetEvPct: 100, evBandPct: 10 });
    await savePackEv(db, "gold", { targetEvPct: 100, evBandPct: 10 });
    const base = await stock("FillBase", 10, 1000);
    await stageRestock(db, "t", "cobalt", base.map((c) => c.id), "add");
    await publishRestock(db, "t", "cobalt");
    const old = new Date(Date.now() - 3 * 60 * 60_000);
    const fit = await stock("FillFit", 2, 1000);
    const fresh = await stock("FillFresh", 1, 1000); // listed just now: inside the hold
    const demo = await stock("FillDemo", 1, 1000);
    const jp = await stock("FillJp", 1, 3899, { language: "Japanese" }); // Mystery is English only
    const active = await stock("FillActive", 1, 1000);
    await db.siteCopy.updateMany({ where: { id: { in: [...fit, ...demo, ...jp, ...active].map((c) => c.id) } }, data: { createdAt: old } });
    await db.siteCopy.update({ where: { id: demo[0].id }, data: { demo: true } });
    await setListing(db, "t", [active[0].id], true);
    // Switch off everywhere: nothing listed moves.
    expect(await runAutoRestock(db)).toMatchObject({ ran: true, routed: 0, versions: [] });
    expect(await db.siteCopy.count({ where: { status: "POOLED", packId: "cobalt" } })).toBe(10);

    await savePackEv(db, "cobalt", { autoDrafts: true });
    expect((await stagedRestocks(db)).find((r) => r.packId === "cobalt")!.ev.autoDrafts).toBe(true);
    const run = await runAutoRestock(db, { now: new Date(Date.now() + 61 * 60_000) });
    expect(run).toMatchObject({ ran: true, routed: 2, drafts: 2, held: 0, versions: [{ packId: "cobalt", version: 3 }] });
    const v3 = await db.siteRestock.findFirstOrThrow({ where: { packId: "cobalt", version: 3 } });
    expect(v3).toMatchObject({ auto: true, actor: "auto-restock", note: "Auto Restock" });
    expect([...(v3.addIds as string[])].sort()).toEqual(fit.map((c) => c.id).sort());
    // Gold has a target but its switch is off, so the Japanese card stays in Draft; so do the fresh, demo and Active cards.
    for (const c of [...fresh, ...demo, ...jp]) expect((await db.siteCopy.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("DRAFT");
    expect((await db.siteCopy.findUniqueOrThrow({ where: { id: active[0].id } })).status).toBe("FOR_SALE");
    // Both switched on: the Japanese card can only go to Gold (Mystery is English only).
    await savePackEv(db, "gold", { autoDrafts: true });
    // Two hours on, the fresh card is past its hold too. Each card lands in the one pool whose EV it fits.
    const run2 = await runAutoRestock(db, { now: new Date(Date.now() + 122 * 60_000) });
    expect(run2).toMatchObject({ routed: 2, drafts: 2 });
    expect((await db.siteCopy.findUniqueOrThrow({ where: { id: jp[0].id } })).packId).toBe("gold");
    expect((await db.siteCopy.findUniqueOrThrow({ where: { id: fresh[0].id } })).packId).toBe("cobalt");
    expect((await db.siteCopy.findUniqueOrThrow({ where: { id: demo[0].id } })).status).toBe("DRAFT");
    // Clearing the target turns the switch off.
    await savePackEv(db, "gold", { targetEvPct: null });
    expect((await db.sitePack.findUniqueOrThrow({ where: { id: "gold" } })).autoDrafts).toBe(false);
  });

  it("Auto-Pick Packs stages Drafts into the pack that fits (no hold, switch not needed), then Publish All", async () => {
    await expect(autoStageDrafts(db, "t", "all")).rejects.toThrow(/Target EV/);
    await savePackEv(db, "cobalt", { targetEvPct: 100, evBandPct: 10 });
    await savePackEv(db, "gold", { targetEvPct: 100, evBandPct: 10 });
    const base = await stock("PickBase", 10, 1000);
    await stageRestock(db, "t", "cobalt", base.map((c) => c.id), "add");
    await publishRestock(db, "t", "cobalt");
    const fit = await stock("PickFit", 2, 1000); // listed just now: no 2-hour wait for staff
    const jp = await stock("PickJp", 1, 3899, { language: "Japanese" }); // Mystery is English only → Gold
    const demo = await stock("PickDemo", 1, 1000);
    await db.siteCopy.update({ where: { id: demo[0].id }, data: { demo: true } });
    const unpriced = await stock("PickNoPrice", 1, 1000);
    await db.siteCopy.update({ where: { id: unpriced[0].id }, data: { retailBits: 0 } });
    await db.sitePrice.deleteMany({ where: { printingKey: { contains: "PickNoPrice" } } });
    const big = await stock("PickBig", 1, 50_000); // would push either pool far out of band
    const r = await autoStageDrafts(db, "t", "all");
    expect(r).toMatchObject({ staged: 3 });
    expect(r.packs.map((p) => [p.packId, p.staged]).sort()).toEqual([["cobalt", 2], ["gold", 1]]);
    // Staged only: pools are unchanged until publish, and the cards are locked to their restock.
    expect(await db.siteCopy.count({ where: { status: "POOLED", packId: "cobalt" } })).toBe(10);
    for (const c of fit) expect((await db.siteCopy.findUniqueOrThrow({ where: { id: c.id } })).restockId).not.toBeNull();
    for (const c of [...demo, ...unpriced, ...big]) expect((await db.siteCopy.findUniqueOrThrow({ where: { id: c.id } })).restockId).toBeNull();
    // A second press doesn't stage anything twice, and counts already staged cards toward each pool's EV.
    expect((await autoStageDrafts(db, "t", "all")).staged).toBe(0);
    // Selected cards only: a demo card can be picked explicitly.
    const more = await stock("PickMore", 1, 1000);
    expect((await autoStageDrafts(db, "t", [more[0].id])).packs).toEqual([expect.objectContaining({ packId: "cobalt", staged: 1 })]);
    const pub = await publishAllStaged(db, "t");
    expect(pub.published.map((p) => [p.packId, p.added]).sort()).toEqual([["cobalt", 3], ["gold", 1]]);
    expect(await db.siteCopy.count({ where: { status: "POOLED", packId: "cobalt" } })).toBe(13);
    expect((await db.siteCopy.findUniqueOrThrow({ where: { id: jp[0].id } })).packId).toBe("gold");
    expect((await publishAllStaged(db, "t")).published).toEqual([]);
  });

  it("enforces pool rules at staging and re-ranks tiers at each restock; a pull keeps its tier", async () => {
    await savePackEv(db, "cobalt", { targetEvPct: 110, evBandPct: 10 });
    await savePackEv(db, "cobalt", { languages: ["English", "Japanese"], minValueBits: 100, maxValueBits: 50_000, typeCaps: { Japanese: 40 }, tierMix: [50, 25, 15, 8, 2], topTierMin: null });
    expect(await db.sitePack.findUniqueOrThrow({ where: { id: "cobalt" } })).toMatchObject({ targetEvPct: 110, evBandPct: 10, minValueBits: 100 }); // rules save keeps EV
    await expect(savePackEv(db, "cobalt", { tierMix: [50, 25, 15, 8, 0] })).rejects.toThrow(RestockError);
    await expect(savePackEv(db, "cobalt", { minValueBits: 900, maxValueBits: 100 })).rejects.toThrow(RestockError);
    const low = await stock("Lowball", 1, 50);
    const ok = await stock("Okay", 10, 500);
    const top = await stock("Topper", 1, 20_000);
    const r1 = await stageRestock(db, "t", "cobalt", [...low, ...ok, ...top].map((c) => c.id), "add");
    expect(r1.staged).toBe(11);
    expect(r1.blocked).toEqual([{ id: low[0].id, reason: expect.stringMatching(/Below/) }]);
    const v2 = await publishRestock(db, "t", "cobalt");
    expect(v2.tierRules).toEqual(expect.arrayContaining([{ name: "Legendary", min: 20_000 }]));
    expect((await db.sitePack.findUniqueOrThrow({ where: { id: "cobalt" } })).tiersAt).not.toBeNull();
    // Japanese cap: 40% of an 11-card pool → the 6th Japanese card would break it.
    const jp = await stock("Nihon", 8, 600, { language: "Japanese" });
    const r2 = await stageRestock(db, "t", "cobalt", jp.map((c) => c.id), "add");
    expect(r2.staged).toBe(7); // 7 of 18 = 38.9%; the 8th would be 8/19 = 42%
    expect(r2.blocked[0].reason).toMatch(/Japanese/);
    // Pull every card (11 + nothing published yet for the Japanese) and check stamped tiers.
    await db.sitePack.update({ where: { id: "cobalt" }, data: { cardsPerPack: 1 } });
    const pulls: string[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await storeAction(db, customer, { action: "open", requestId: randomUUID(), id: "cobalt" });
      pulls.push(String(r.openingId));
    }
    const pulled = await db.siteCopy.findMany({ where: { openingId: { in: pulls } } });
    expect(pulled.every((c) => c.pulledTier)).toBe(true);
    expect(pulled.find((c) => c.name === "Topper")?.pulledTier).toBe("Legendary");
    // Publishing the Japanese cards re-ranks the pool; the earlier Legendary pull stays Legendary.
    const v3 = await publishRestock(db, "t", "cobalt");
    expect(v3.poolSize).toBe(7);
    expect((await db.siteCopy.findFirstOrThrow({ where: { name: "Topper" } })).pulledTier).toBe("Legendary");
    const view = (await stagedRestocks(db)).find((p) => p.packId === "cobalt")!;
    expect(view.rules.cutoffs.at(-1)?.name).toBe("Legendary");
    expect(view.rules.mix).toMatchObject({ Japanese: 7 });
  });

  it("Target EV can't pass the loop ceiling; Reshuffle previews, then publishes one version; hourly fix only adds", async () => {
    await expect(savePackEv(db, "cobalt", { targetEvPct: 115, evBandPct: 5 })).rejects.toThrow(/at most 112%/);
    await savePackEv(db, "cobalt", { targetEvPct: 110, evBandPct: 5 });
    // Pool: 10 cards, EV 120 → margin 4%.
    const base = await stock("LoopBase", 7, 1000);
    const mid = await stock("LoopMid", 2, 1500);
    const chase = await stock("LoopChase", 1, 2000);
    await stageRestock(db, "t", "cobalt", [...base, ...mid, ...chase].map((c) => c.id), "add");
    await publishRestock(db, "t", "cobalt");
    let v = (await stagedRestocks(db)).find((p) => p.packId === "cobalt")!;
    expect(v.now.evPct).toBe(120);
    expect(v.loop).toMatchObject({ marginNowPct: 4, minPct: 10, evCeilingPct: 112.5, band: { lo: 105, hi: 112.5, aim: 110, capped: true }, draftsCanFix: false });
    // Reshuffle with no Drafts: preview takes a card out (not the chase); nothing changes until applied.
    const prev = await reshufflePack(db, "t", "cobalt", false);
    expect(prev).toMatchObject({ applied: false, evBefore: 120, evAfter: 112.5, marginAfter: 10, adds: [], inBand: true });
    expect(prev.removes.map((r) => r.id).sort()).toEqual(mid.map((c) => c.id).sort());
    expect(prev.removes.map((r) => r.id)).not.toContain(chase[0].id);
    expect(await db.siteCopy.count({ where: { packId: "cobalt", status: "POOLED" } })).toBe(10);
    const done = await reshufflePack(db, "t", "cobalt", true);
    expect(done).toMatchObject({ applied: true, version: 3 });
    expect(done.evAfter!).toBeLessThanOrEqual(112.5);
    expect(done.marginAfter!).toBeGreaterThanOrEqual(10);
    const v3 = await db.siteRestock.findFirstOrThrow({ where: { packId: "cobalt", version: 3 } });
    expect(v3).toMatchObject({ note: "Reshuffle", auto: false });
    expect((v3.removeIds as string[]).length).toBe(prev.removes.length);
    for (const id of v3.removeIds as string[]) expect((await db.siteCopy.findUniqueOrThrow({ where: { id } })).status).toBe("DRAFT");
    await expect(reshufflePack(db, "t", "cobalt", true)).rejects.toThrow(RestockError);

    // Hourly add-only fix: push EV up with a new chase card, list cheap Drafts past the hold → it adds, never removes.
    const old = new Date(Date.now() - 3 * 60 * 60_000);
    const hot = await stock("LoopHot", 1, 4000);
    await stageRestock(db, "t", "cobalt", hot.map((c) => c.id), "add");
    await publishRestock(db, "t", "cobalt");
    const evHot = (await stagedRestocks(db)).find((p) => p.packId === "cobalt")!.now.evPct!;
    expect(evHot).toBeGreaterThan(112.5);
    await db.siteCopy.updateMany({ where: { status: "DRAFT" }, data: { createdAt: old } });
    const cheap = await stock("LoopCheap", 6, 400);
    await db.siteCopy.updateMany({ where: { id: { in: cheap.map((c) => c.id) } }, data: { createdAt: old } });
    await savePackEv(db, "cobalt", { autoDrafts: true });
    const poolBefore = await db.siteCopy.findMany({ where: { packId: "cobalt", status: "POOLED" }, select: { id: true } });
    const run = await runAutoRestock(db, { now: new Date(Date.now() + 61 * 60_000) });
    expect(run.ran).toBe(true);
    for (const c of poolBefore) expect((await db.siteCopy.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("POOLED");
    v = (await stagedRestocks(db)).find((p) => p.packId === "cobalt")!;
    expect(v.now.evPct!).toBeLessThanOrEqual(112.5);
    expect(v.now.evPct!).toBeGreaterThanOrEqual(105);
  });

  it("flags pools outside their EV band and suggests Draft cards that bring them back", async () => {
    await savePackEv(db, "cobalt", { targetEvPct: 100, evBandPct: 5 });
    const cheap = await stock("Cheap", 10, 500);
    await stageRestock(db, "t", "cobalt", cheap.map((c) => c.id), "add");
    await publishRestock(db, "t", "cobalt");
    await stock("Chase", 1, 6000);
    await stock("Filler", 1, 400);
    const v = (await stagedRestocks(db)).find((p) => p.packId === "cobalt")!;
    expect(v.ev).toMatchObject({ targetPct: 100, needsRestock: true });
    expect(v.now.evPct).toBe(50);
    expect(v.suggestions.map((s) => s.title)).toEqual(["Chase - 1/100"]);
    expect(v.history[0].evPct).toBe(50);
    expect(priceKey).toBeTypeOf("function");
  });
});
