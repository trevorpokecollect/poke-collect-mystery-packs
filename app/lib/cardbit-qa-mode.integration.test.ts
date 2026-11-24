import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CARDBIT_SHOP as shop } from "./cardbit.server";
import { weeklyStandings } from "./cardbit-leaderboard.server";
import { dailyCheckIn, rewardsView } from "./cardbit-levels.server";
import { dailySpin } from "./cardbit-spinner.server";
import { buySparkShopCard } from "./cardbit-spark-shop.server";

const url = process.env.TEST_DATABASE_URL;
const qa = "gid://shopify/Customer/501",
  real = "gid://shopify/Customer/502";
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });

describe.skipIf(!url)("Cardbit QA mode", () => {
  beforeAll(async () => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
    vi.stubEnv("CARDBIT_STOREFRONT_SHOP", shop);
    vi.stubEnv("CARDBIT_QA_CUSTOMERS", "501");
    for (const f of ["CARDBIT_LEVELS", "CARDBIT_SPARKS", "CARDBIT_SPINNER", "CARDBIT_LEADERBOARD"]) vi.stubEnv(f, "qa");
    for (const [customerId, delta] of [[qa, -500], [real, -9000]] as const)
      await db.cardbitReceipt.create({
        data: { shop, eventKey: "qa-test:" + randomUUID(), customerId, fingerprint: "t", kind: "pack", delta },
      });
  });
  afterAll(async () => {
    await db.cardbitReceipt.deleteMany({ where: { shop } });
    await db.cardbitSpin.deleteMany({ where: { shop } });
    await db.cardbitXpEvent.deleteMany({ where: { shop } });
    await db.cardbitSparkTxn.deleteMany({ where: { shop } });
    await db.cardbitSparkWallet.deleteMany({ where: { shop } });
    await db.cardbitProfile.deleteMany({ where: { shop } });
    await db.$disconnect();
    vi.unstubAllEnvs();
  });

  it("QA customers can check in and spin; everyone else is refused", async () => {
    expect((await dailyCheckIn(db, shop, qa)).xp).toBeGreaterThan(0);
    const view = await rewardsView(db, shop, qa);
    expect(view.features).toMatchObject({ spinner: true, sparks: true, leaderboard: true });
    expect(view.sparks).toEqual({ balance: 0 });
    await expect(dailySpin(db, shop, qa)).resolves.toBeTruthy();
    await expect(dailySpin(db, shop, real)).rejects.toThrow(/not open/);
    await expect(
      buySparkShopCard(db, shop, real, { cardId: "x", requestId: randomUUID(), sparks: 250 }),
    ).rejects.toThrow(/not open/);
    expect((await rewardsView(db, shop, real)).features).toMatchObject({ spinner: false, sparks: false, leaderboard: false });
  });

  it("QA leaderboard ranks only QA customers", async () => {
    const board = await weeklyStandings(db, shop, qa);
    expect(board.top).toHaveLength(1);
    expect(board.top[0]).toMatchObject({ rank: 1, score: 500, you: true });
    vi.stubEnv("CARDBIT_LEADERBOARD", "on");
    expect((await weeklyStandings(db, shop, qa)).top.map((r) => r.score)).toEqual([9000, 500]);
    vi.stubEnv("CARDBIT_LEADERBOARD", "qa");
  });
});
