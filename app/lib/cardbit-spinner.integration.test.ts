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
    await expect(dailySpin(db, shop, a)).rejects.toThrow("not open");
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
    const [one, two] = await Promise.all([dailySpin(db, shop, a, day), dailySpin(db, shop, a, day)]);
    expect(one.id).toBe(two.id);
    expect(one.prizeKind).toBe("card");
    const pull = await db.pull.findUniqueOrThrow({ where: { id: one.pullId! } });
    expect(pull).toMatchObject({ customerId: a, status: "REVEALED" });
    // The only copy is gone, so another customer's card slice falls back to XP.
    const other = await dailySpin(db, shop, b, day);
    expect(other).toMatchObject({ prizeKind: "xp", amount: 40, pullId: null });
    expect(await db.pull.count({ where: { shop, seriesId: s.id } })).toBe(1);
    expect((await dailySpin(db, shop, a, new Date("2026-11-25T18:00:00Z"))).prizeKind).toBe("xp");
    expect(await db.cardbitSpin.count({ where: { shop, customerId: c } })).toBe(0);
  });
});
