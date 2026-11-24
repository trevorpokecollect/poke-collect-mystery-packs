import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CARDBIT_SHOP as shop } from "./cardbit.server";
import { launchSeries } from "./pool.server";
import { SPIN_TABLE_KEY, dailySpin } from "./cardbit-spinner.server";

const url = process.env.TEST_DATABASE_URL;
const a = "gid://shopify/Customer/401", b = "gid://shopify/Customer/402", c = "gid://shopify/Customer/403";
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });

describe.skipIf(!url)("Daily Spinner integration", () => {
  beforeAll(async () => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
    vi.stubEnv("CARDBIT_STOREFRONT_SHOP", shop);
    vi.stubEnv("CARDBIT_SPINNER", "off");
    vi.stubEnv("CARDBIT_SPARKS", "off");
    await db.appValue.upsert({
      where: { key: SPIN_TABLE_KEY },
      create: { key: SPIN_TABLE_KEY, value: JSON.stringify({ basic: [{ kind: "card", weight: 1 }, { kind: "xp", amount: 40, weight: 0 }] }) },
      update: { value: JSON.stringify({ basic: [{ kind: "card", weight: 1 }, { kind: "xp", amount: 40, weight: 0 }] }) },
    });
  });
  afterAll(async () => {
    await db.cardbitSpin.deleteMany({ where: { shop } });
    await db.pull.deleteMany({ where: { shop } });
    await db.packOrder.deleteMany({ where: { shop } });
    await db.series.deleteMany({ where: { shop, handle: "spin-qa" } });
    await db.cardbitXpEvent.deleteMany({ where: { shop } });
    await db.cardbitProfile.deleteMany({ where: { shop } });
    await db.appValue.deleteMany({ where: { key: SPIN_TABLE_KEY } });
    await db.$disconnect();
    vi.unstubAllEnvs();
  });

  it("stays closed while the flag is off", async () => {
    await expect(dailySpin(db, shop, a, "basic")).rejects.toThrow("not available");
  });

  it("awards one stored result per day, reserves each prize copy once, and falls back when the pool is empty", async () => {
    vi.stubEnv("CARDBIT_SPINNER", "on");
    const s = await db.series.create({
      data: {
        shop, handle: "spin-qa", title: "Daily Spin QA", packProductId: "spin", packVariantId: "spin:basic",
        packPrice: 0, cardsPerPack: 1, buildRules: { cardbitDailySpin: "basic" },
        cards: { create: [{ productId: "sp-card", variantId: "sp-card-variant", title: "Prize", tier: "Base", marketValue: 1, quantity: 1 }] },
      },
    });
    await launchSeries(db, s.id);
    const day = new Date("2026-11-24T18:00:00Z");
    const [one, two] = await Promise.all([dailySpin(db, shop, a, "basic", day), dailySpin(db, shop, a, "basic", day)]);
    expect(one.id).toBe(two.id);
    expect(one.prizeKind).toBe("card");
    const pull = await db.pull.findUniqueOrThrow({ where: { id: one.pullId! } });
    expect(pull).toMatchObject({ customerId: a, status: "REVEALED" });
    // The only copy is gone, so another customer's card slice falls back to XP.
    const other = await dailySpin(db, shop, b, "basic", day);
    expect(other).toMatchObject({ prizeKind: "xp", amount: 40, pullId: null });
    expect(await db.pull.count({ where: { shop, seriesId: s.id } })).toBe(1);
    expect((await dailySpin(db, shop, a, "basic", new Date("2026-11-25T18:00:00Z"))).prizeKind).toBe("xp");
    expect(await db.cardbitSpin.count({ where: { shop, customerId: c } })).toBe(0);
  });

  it("gives each unlocked tier its own daily spin and refuses locked tiers", async () => {
    const day = new Date("2026-11-26T18:00:00Z");
    await expect(dailySpin(db, shop, c, "bronze", day)).rejects.toThrow("Reach Level 5");
    await expect(dailySpin(db, shop, c, "nope", day)).rejects.toThrow("Choose a spin");
    // Level 5 needs 1,600 XP.
    await db.cardbitProfile.update({ where: { shop_customerId: { shop, customerId: c } }, data: { xp: 1600 } }).catch(async () =>
      db.cardbitProfile.create({ data: { shop, customerId: c, xp: 1600 } }),
    );
    const basic = await dailySpin(db, shop, c, "basic", day);
    const bronze = await dailySpin(db, shop, c, "bronze", day);
    expect(basic.id).not.toBe(bronze.id);
    expect((await dailySpin(db, shop, c, "bronze", day)).replay).toBe(true);
    expect(await db.cardbitSpin.count({ where: { shop, customerId: c } })).toBe(2);
  });

  it("lists every tier with today's result and odds", async () => {
    const { spinsView } = await import("./cardbit-spinner.server");
    const view = await spinsView(db, shop, c, 5, 0, new Date("2026-11-26T18:00:00Z"));
    expect(view.map((t) => [t.id, t.unlocked, !!t.result])).toEqual([
      ["basic", true, true], ["bronze", true, true], ["silver", false, false],
      ["gold", false, false], ["cobalt", false, false], ["holo", false, false],
    ]);
    expect(view[0].odds.every((o) => o.kind !== "card")).toBe(true);
  });
});
