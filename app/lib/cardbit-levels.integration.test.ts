import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CARDBIT_SHOP as shop } from "./cardbit.server";
import { recordFunding, walletAction } from "./cardbits.server";
import { launchSeries } from "./pool.server";
import { dailyCheckIn, reverseXp, rewardsView, setAvatar } from "./cardbit-levels.server";

const url = process.env.TEST_DATABASE_URL;
const qa = "gid://shopify/Customer/301",
  other = "gid://shopify/Customer/302";
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });

describe.skipIf(!url)("Cardbit levels integration", () => {
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
    vi.stubEnv("CARDBIT_STOREFRONT_SHOP", shop);
    vi.stubEnv("CARDBIT_COMMERCE_MODE", "staging");
    vi.stubEnv("CARDBIT_QA_CUSTOMERS", qa + "," + other);
    vi.stubEnv("CARDBIT_TEST_SERIES", '{"levels-qa":1000}');
    vi.stubEnv("CARDBIT_LEVELS", "on");
  });
  afterAll(async () => {
    await db.pullTransfer.deleteMany({ where: { shop } });
    await db.pull.deleteMany({ where: { shop } });
    await db.packOrder.deleteMany({ where: { shop } });
    await db.series.deleteMany({ where: { shop, handle: "levels-qa" } });
    await db.cardbitReceipt.deleteMany({ where: { shop } });
    await db.cardbitWallet.deleteMany({ where: { shop } });
    await db.cardbitXpEvent.deleteMany({ where: { shop } });
    await db.cardbitProfile.deleteMany({ where: { shop } });
    await db.$disconnect();
    vi.unstubAllEnvs();
  });

  it("awards pack XP once per paid opening, even on a retried request", async () => {
    const s = await db.series.create({
      data: {
        shop, staffTest: true, handle: "levels-qa", title: "Levels QA",
        packProductId: "lv-pack", packVariantId: "lv-pack-variant", packPrice: 10, cardsPerPack: 1,
        cards: { create: [{ productId: "lv-card", variantId: "lv-card-variant", title: "Card", tier: "Base", marketValue: 1, quantity: 5 }] },
      },
    });
    const live = await launchSeries(db, s.id);
    await recordFunding(db, shop, { id: "lv-fund-" + randomUUID(), customerId: qa, amount: 3000 });
    const buy = { action: "pack" as const, id: s.id, requestId: randomUUID(), amount: 1000, version: live.commitHash! };
    await Promise.all([walletAction(db, shop, qa, buy), walletAction(db, shop, qa, buy)]);
    expect((await rewardsView(db, shop, qa)).xp).toBe(125);
    await walletAction(db, shop, qa, { ...buy, requestId: randomUUID() });
    expect((await rewardsView(db, shop, qa)).xp).toBe(250);
    expect((await rewardsView(db, shop, other)).xp).toBe(0);

    const key = "pack:" + qa + "/" + buy.requestId;
    await Promise.all([1, 2].map(() => db.$transaction((tx) => reverseXp(tx, shop, key, "refund"))));
    await db.$transaction((tx) => reverseXp(tx, shop, key, "refund"));
    expect((await rewardsView(db, shop, qa)).xp).toBe(125);
  });

  it("checks in once per Central day and tracks the streak", async () => {
    const day1 = new Date("2026-11-24T18:00:00Z");
    const [a, b] = await Promise.all([dailyCheckIn(db, shop, other, day1), dailyCheckIn(db, shop, other, day1)]);
    expect([a.already, b.already].sort()).toEqual([false, true]);
    expect((await dailyCheckIn(db, shop, other, new Date("2026-11-25T05:00:00Z"))).already).toBe(true);
    expect((await dailyCheckIn(db, shop, other, new Date("2026-11-25T18:00:00Z"))).streak).toBe(2);
    expect((await dailyCheckIn(db, shop, other, new Date("2026-11-27T18:00:00Z"))).streak).toBe(1);
    expect((await rewardsView(db, shop, other, new Date("2026-11-27T18:00:00Z"))).xp).toBe(150);
  });

  it("only lets a customer pick unlocked icons and listed colors", async () => {
    await setAvatar(db, shop, other, { iconId: "smorsel", color: "mint" });
    await expect(setAvatar(db, shop, other, { iconId: "latch-holo" })).rejects.toThrow("Reach Level 30");
    await expect(setAvatar(db, shop, other, { color: "#ff0000" })).rejects.toThrow();
    expect((await rewardsView(db, shop, other)).avatar).toEqual({ iconId: "smorsel", color: "mint" });
  });
});
