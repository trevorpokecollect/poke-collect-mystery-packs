import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { receiveSiteIntake } from "../core/stock.server";
import { publishRestock, runAutoRestock, savePackEv, stageRestock, stagedRestocks, ruleBreak, fillTargets } from "../core/restock.server";
import { confirmAge } from "../../lib/cardbit-age.server";
import { dailySpin, SITE_SPIN_TABLE_KEY } from "../../lib/cardbit-spinner.server";
import { rollAmount, fallbackSlice, displayOdds } from "../../lib/cardbit-spinner";
import { siteSparkPrice } from "../../lib/cardbit-sparks";
import { redeemSparkCard, sparkShopCards, SparkShopError } from "./spark-shop.server";
import { saveSiteSpinTier, siteSpinTableView, SpinTableError } from "./spin-table.server";
import { spinRulesHtml } from "./spin-rules.server";
import { DEFAULT_SPIN_TABLE } from "../../lib/cardbit-spinner";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const SHOP = "cardbit-site";
let seq = 0;

describe("spin table helpers", () => {
  it("rolls ranges evenly within bounds and falls back to the top Sparks result", () => {
    const s = { kind: "sparks" as const, amount: 25, max: 50, weight: 1 };
    expect(rollAmount(s, () => 0)).toBe(25);
    expect(rollAmount(s, (n) => n - 1)).toBe(50);
    expect(rollAmount({ kind: "xp", amount: 7, weight: 1 }, () => 3)).toBe(7);
    const fb = fallbackSlice([{ kind: "xp", amount: 900, weight: 1 }, { kind: "sparks", amount: 10, max: 400, weight: 1 }, { kind: "sparks", amount: 300, weight: 1 }]);
    expect(fb).toMatchObject({ kind: "sparks", max: 400 });
    expect(displayOdds([s, { kind: "xp", amount: 5, weight: 1 }])).toEqual([
      { kind: "sparks", amount: 25, max: 50, percent: 50 },
      { kind: "xp", amount: 5, max: null, percent: 50 },
    ]);
  });

  it("prices Spark Shop cards at 5 Sparks per Cardbit (about 500 per $1)", () => {
    expect(siteSparkPrice(100)).toBe(500);
    expect(siteSparkPrice(37)).toBe(185);
    expect(siteSparkPrice(null)).toBeNull();
    expect(siteSparkPrice(0)).toBeNull();
  });

  it("caps spin pools at the Official Rules maximum and reads Fill Rules", () => {
    const spin = { id: "spin-basic", kind: "spin", languages: null, eras: null, minValueBits: null, maxValueBits: null, typeCaps: null };
    const card = { language: "English", era: null, setName: "Paldea" };
    expect(ruleBreak(spin, card, 500)).toBeNull();
    expect(ruleBreak(spin, card, 501)).toMatch(/Official Rules/);
    expect(fillTargets([{ minBits: 100, maxBits: 200, count: 3 }, { minBits: 0, maxBits: 99, count: 5 }, { minBits: 5, count: 0 }])).toEqual([
      { minBits: 0, maxBits: 99, count: 5 },
      { minBits: 100, maxBits: 200, count: 3 },
    ]);
  });

  it("builds Official Rules C4 from the table (defaults match the published numbers)", () => {
    const html = spinRulesHtml(DEFAULT_SPIN_TABLE, null);
    expect(html).toContain("<td>Sprout</td>\n<td>2.0%</td>\n<td>50 Sparks, 15.0%<br>25 Sparks, 30.0%</td>\n<td>5 XP, 53.0%</td>");
    expect(html).toContain("3.4% (Sprout), 5.0% (Ember), 6.6% (Frost), 12.9% (Gold Rush), 23.1% (Dragon) and 32.4% (Prism)");
    expect(html).toContain("Prism $100.00");
    const ranged = spinRulesHtml({ ...DEFAULT_SPIN_TABLE, basic: [{ kind: "card", weight: 10 }, { kind: "sparks", amount: 20, max: 60, weight: 40 }, { kind: "xp", amount: 3, max: 9, weight: 50 }] }, new Date("2026-11-26T22:00:00Z"));
    expect(ranged).toContain("<td>20–60 Sparks, 40.0%</td>");
    expect(ranged).toContain("3–9 XP, 50.0%");
    expect(ranged).toContain("last changed on November 26, 2026");
  });
});

describe.skipIf(!url)("prize pools", () => {
  const env = { ...process.env };
  let customer: { id: string };
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  const wipe = async () => {
    await db.cardbitSpin.deleteMany({ where: { shop: SHOP } });
    await db.cardbitSparkTxn.deleteMany({ where: { shop: SHOP } });
    await db.cardbitSparkWallet.deleteMany({ where: { shop: SHOP } });
    await db.cardbitProfile.deleteMany({ where: { shop: SHOP } });
    await db.siteRequest.deleteMany();
    await db.siteCopyEvent.deleteMany();
    await db.siteRestock.deleteMany();
    await db.siteCopy.deleteMany();
    await db.siteIntakeReceipt.deleteMany();
    await db.sitePrice.deleteMany();
    await db.siteLedger.deleteMany();
    await db.siteWallet.deleteMany();
    await db.appValue.deleteMany({ where: { key: { in: [SITE_SPIN_TABLE_KEY, "cardbit-site:auto-restock"] } } });
    await db.cardbitAgeConfirmation.deleteMany({ where: { shop: SHOP } });
    await db.siteCustomer.deleteMany({ where: { email: { endsWith: "@prize.test" } } });
    await db.sitePack.updateMany({ where: { kind: { not: "pack" } }, data: { autoDrafts: false, fillTargets: Prisma.DbNull, minValueBits: null, typeCaps: Prisma.DbNull, tierRules: Prisma.DbNull } });
    await db.sitePack.updateMany({ where: { kind: "pack" }, data: { autoDrafts: false, targetEvPct: null } });
  };
  async function stock(name: string, n: number, retail: number, extra: Record<string, unknown> = {}) {
    await receiveSiteIntake(db, {
      eventKey: `prize-${name}-${++seq}`, quantity: n, title: `${name} - 1/100`, game: "pokemon", setName: "Prize Set", number: `${seq}/100`,
      name, finish: "Holofoil", language: "English", condition: "Near Mint", priceBits: retail, buybackBits: Math.round(retail * 0.8), ...extra,
    });
    return db.siteCopy.findMany({ where: { name }, orderBy: { id: "asc" } });
  }
  async function pool(packId: string, ids: string[]) {
    const s = await stageRestock(db, "staff:test", packId, ids, "add");
    if (s.staged) await publishRestock(db, "staff:test", packId, "test");
    return s;
  }
  const newCustomer = async (tag: string) => {
    const c = await db.siteCustomer.create({ data: { email: `${tag}-${randomUUID().slice(0, 6)}@prize.test` } });
    await confirmAge(db, SHOP, c.id, "signup");
    return c;
  };
  const giveSparks = (customerId: string, n: number) =>
    db.cardbitSparkWallet.upsert({ where: { shop_customerId: { shop: SHOP, customerId } }, create: { shop: SHOP, customerId, balance: n }, update: { balance: n } });

  beforeEach(async () => {
    process.env.CARDBIT_SITE = "on";
    process.env.CARDBIT_SPINNER = "on";
    process.env.CARDBIT_SPARKS = "on";
    process.env.CARDBIT_LEVELS = "on";
    await wipe();
    customer = await newCustomer("spin");
  });
  afterEach(() => {
    process.env = { ...env };
  });
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it("seeds one pool per spin plus the Spark Shop, all unsellable", async () => {
    const prize = await db.sitePack.findMany({ where: { kind: { not: "pack" } }, orderBy: { sortOrder: "asc" } });
    expect(prize.map((p) => [p.id, p.kind, p.active, p.priceBits])).toEqual([
      ["spin-basic", "spin", false, 0], ["spin-bronze", "spin", false, 0], ["spin-silver", "spin", false, 0],
      ["spin-gold", "spin", false, 0], ["spin-cobalt", "spin", false, 0], ["spin-holo", "spin", false, 0], ["sparks-shop", "sparks", false, 0],
    ]);
    const view = await stagedRestocks(db);
    expect(view.find((r) => r.packId === "sparks-shop")).toMatchObject({ kind: "sparks", fill: [] });
    await expect(savePackEv(db, "spin-basic", { targetEvPct: 100 })).rejects.toThrow(/no EV/);
    await expect(savePackEv(db, "cobalt", { fillTargets: [{ minBits: 0, maxBits: 100, count: 1 }] })).rejects.toThrow(/prize pools/);
    await expect(savePackEv(db, "sparks-shop", { autoDrafts: true })).rejects.toThrow(/Fill Rules/);
    await expect(savePackEv(db, "sparks-shop", { fillTargets: [{ minBits: 0, maxBits: 100, count: 1 }, { minBits: 50, maxBits: 200, count: 1 }] })).rejects.toThrow(/overlap/);
  });

  it("a card spin takes one copy from that spin's pool into the Vault; replays never award again", async () => {
    await saveSiteSpinTier(db, "basic", [{ kind: "card", weight: 1 }, { kind: "sparks", min: 25, max: 50, weight: 0 }, { kind: "xp", min: 5, weight: 0 }]);
    const cards = await stock("SpinPrize", 2, 300);
    expect((await pool("spin-basic", cards.map((c) => c.id))).staged).toBe(2);
    const first = await dailySpin(db as never, SHOP, customer.id, "basic");
    expect(first.prizeKind).toBe("card");
    expect(first.card?.title).toBe("SpinPrize - 1/100");
    const won = await db.siteCopy.findUniqueOrThrow({ where: { id: first.copyId! } });
    expect(won).toMatchObject({ status: "VAULTED", ownerId: customer.id, packId: null, acquiredVia: "spin" });
    expect(first.valueBits).toBe(300);
    const again = await dailySpin(db as never, SHOP, customer.id, "basic");
    expect(again.replay).toBe(true);
    expect(again.copyId).toBe(first.copyId);
    expect(await db.siteCopy.count({ where: { packId: "spin-basic", status: "POOLED" } })).toBe(1);
  });

  it("never awards a card over the spin's cap; it pays the top Sparks range instead", async () => {
    await saveSiteSpinTier(db, "basic", [{ kind: "card", weight: 1 }, { kind: "sparks", min: 40, max: 60, weight: 0 }, { kind: "sparks", min: 5, weight: 0 }, { kind: "xp", min: 5, weight: 0 }]);
    const [big] = await stock("TooBig", 1, 900);
    // Staff can't stage it (Official Rules cap) ...
    const s = await stageRestock(db, "staff:test", "spin-basic", [big.id], "add");
    expect(s.staged).toBe(0);
    expect(s.blocked[0].reason).toMatch(/maximum/);
    // ... and even if it got into the pool, the draw skips it.
    await db.siteCopy.update({ where: { id: big.id }, data: { status: "POOLED", packId: "spin-basic" } });
    const spin = await dailySpin(db as never, SHOP, customer.id, "basic");
    expect(spin.prizeKind).toBe("sparks");
    expect(spin.amount).toBeGreaterThanOrEqual(40);
    expect(spin.amount).toBeLessThanOrEqual(60);
    expect((await db.cardbitSparkWallet.findUniqueOrThrow({ where: { shop_customerId: { shop: SHOP, customerId: customer.id } } })).balance).toBe(spin.amount);
  });

  it("rolls Sparks and XP ranges and shows them as ranges", async () => {
    await saveSiteSpinTier(db, "basic", [{ kind: "card", weight: 0 }, { kind: "sparks", min: 1, weight: 0 }, { kind: "xp", min: 3, max: 9, weight: 1 }]);
    const spin = await dailySpin(db as never, SHOP, customer.id, "basic");
    expect(spin.prizeKind).toBe("xp");
    expect(spin.amount).toBeGreaterThanOrEqual(3);
    expect(spin.amount).toBeLessThanOrEqual(9);
    const view = await siteSpinTableView(db);
    expect(view.tiers[0].odds.find((o) => o.kind === "xp")).toMatchObject({ amount: 3, max: 9, percent: 100 });
    expect(view.updatedAt).not.toBeNull();
    await expect(saveSiteSpinTier(db, "basic", [{ kind: "xp", min: 5, weight: 1 }, { kind: "sparks", min: 5, weight: 1 }])).rejects.toThrow(SpinTableError);
    await expect(saveSiteSpinTier(db, "basic", [{ kind: "card", weight: 1 }, { kind: "sparks", min: 50, max: 10, weight: 1 }])).rejects.toThrow(/minimum at or below/);
  });

  it("Spark Shop: lists at 5 Sparks per Cardbit, redeems once per request, refuses short balances and changed prices", async () => {
    const cards = await stock("ShopCard", 2, 120);
    await pool("sparks-shop", cards.map((c) => c.id));
    const list = await sparkShopCards(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ sparks: 600, left: 2, title: "ShopCard - 1/100" });
    const key = list[0].key;
    await giveSparks(customer.id, 599);
    await expect(redeemSparkCard(db, customer.id, key, 600, randomUUID())).rejects.toMatchObject({ code: "short" });
    await giveSparks(customer.id, 1000);
    await expect(redeemSparkCard(db, customer.id, key, 500, randomUUID())).rejects.toMatchObject({ code: "price_changed", sparks: 600 });
    const req = randomUUID();
    const r = await redeemSparkCard(db, customer.id, key, 600, req);
    expect(r).toMatchObject({ replay: false, sparks: 600, balance: 400 });
    const again = await redeemSparkCard(db, customer.id, key, 600, req);
    expect(again).toMatchObject({ replay: true, sparks: 600, balance: 400 });
    expect(await db.siteCopy.count({ where: { ownerId: customer.id, status: "VAULTED", acquiredVia: "sparks" } })).toBe(1);
    expect((await sparkShopCards(db))[0].left).toBe(1);
    process.env.CARDBIT_SPARKS = "off";
    await expect(redeemSparkCard(db, customer.id, key, 600, randomUUID())).rejects.toBeInstanceOf(SparkShopError);
  });

  it("Spark Shop: two collectors racing for the last copy, one wins", async () => {
    const [only] = await stock("LastOne", 1, 100);
    await pool("sparks-shop", [only.id]);
    const key = (await sparkShopCards(db))[0].key;
    const a = await newCustomer("a"), b = await newCustomer("b");
    await giveSparks(a.id, 1000);
    await giveSparks(b.id, 1000);
    const out = await Promise.allSettled([redeemSparkCard(db, a.id, key, 500, randomUUID()), redeemSparkCard(db, b.id, key, 500, randomUUID())]);
    expect(out.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(out.filter((x) => x.status === "rejected").map((x) => (x as PromiseRejectedResult).reason.code)).toEqual(["sold_out"]);
    const balances = await db.cardbitSparkWallet.findMany({ where: { shop: SHOP, customerId: { in: [a.id, b.id] } } });
    expect(balances.map((w) => w.balance).sort()).toEqual([1000, 500]);
  });

  it("Auto-Fill keeps each Fill Rule range topped up from listed Drafts, after packs pick first", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 3 * 60 * 60_000);
    const cheap = await stock("Cheap", 5, 50);
    const mid = await stock("Mid", 3, 150);
    const pricey = await stock("Pricey", 2, 5000);
    await db.siteCopy.updateMany({ data: { createdAt: old } });
    await savePackEv(db, "sparks-shop", { fillTargets: [{ minBits: 25, maxBits: 99, count: 3 }, { minBits: 100, maxBits: 200, count: 2 }], autoDrafts: true });
    const r = await runAutoRestock(db, { force: true, now });
    expect(r.ran).toBe(true);
    const pooled = await db.siteCopy.findMany({ where: { packId: "sparks-shop", status: "POOLED" } });
    expect(pooled.filter((c) => c.name === "Cheap")).toHaveLength(3);
    expect(pooled.filter((c) => c.name === "Mid")).toHaveLength(2);
    expect(pooled.filter((c) => c.name === "Pricey")).toHaveLength(0);
    expect(r.versions.some((v) => v.packId === "sparks-shop")).toBe(true);
    // Already full: the next run adds nothing more.
    const r2 = await runAutoRestock(db, { force: true, now: new Date(now.getTime() + 60_000) });
    expect(r2.versions.some((v) => v.packId === "sparks-shop")).toBe(false);
    const view = (await stagedRestocks(db)).find((x) => x.packId === "sparks-shop")!;
    expect(view.fill).toEqual([{ minBits: 25, maxBits: 99, count: 3, have: 3 }, { minBits: 100, maxBits: 200, count: 2, have: 2 }]);
    expect(cheap.length + mid.length + pricey.length).toBe(10);
  });
});
