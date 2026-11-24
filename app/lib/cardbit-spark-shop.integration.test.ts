import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CARDBIT_SHOP as shop } from "./cardbit.server";
import { launchSeries } from "./pool.server";
import { buySparkShopCard, sparkShopView } from "./cardbit-spark-shop.server";

const url = process.env.TEST_DATABASE_URL;
const a = "gid://shopify/Customer/501", b = "gid://shopify/Customer/502";
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });

describe.skipIf(!url)("Spark Shop integration", () => {
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
    vi.stubEnv("CARDBIT_STOREFRONT_SHOP", shop);
    vi.stubEnv("CARDBIT_SPARKS", "on");
  });
  afterAll(async () => {
    await db.pull.deleteMany({ where: { shop } });
    await db.packOrder.deleteMany({ where: { shop } });
    await db.series.deleteMany({ where: { shop, handle: "spark-shop-qa" } });
    await db.cardbitSparkTxn.deleteMany({ where: { shop } });
    await db.cardbitSparkWallet.deleteMany({ where: { shop } });
    await db.$disconnect();
    vi.unstubAllEnvs();
  });

  it("sells each copy once, charges the listed Sparks once per request, and vaults the card", async () => {
    const s = await db.series.create({
      data: {
        shop, handle: "spark-shop-qa", title: "Spark Shop", packProductId: "spark", packVariantId: "spark-shop",
        packPrice: 0, cardsPerPack: 1, buildRules: { cardbitSparkShop: true },
        cards: { create: [
          { productId: "c1", variantId: "c1v", title: "Cheap Single", tier: "Base", marketValue: 0.4, quantity: 1 },
          { productId: "c2", variantId: "c2v", title: "Too Pricey", tier: "Base", marketValue: 9, quantity: 1 },
        ] },
      },
    });
    await launchSeries(db, s.id);
    const view = await sparkShopView(db, shop);
    expect(view).toEqual([expect.objectContaining({ title: "Cheap Single", sparks: 250, remaining: 1 })]);
    expect(JSON.stringify(view)).not.toContain("marketValue");
    for (const c of [a, b]) {
      await db.cardbitSparkWallet.create({ data: { shop, customerId: c, balance: 300 } });
    }
    const req = { cardId: view[0].cardId, requestId: randomUUID(), sparks: 250 };
    await expect(buySparkShopCard(db, shop, a, { ...req, sparks: 100 })).rejects.toThrow("price changed");
    const results = await Promise.allSettled([
      buySparkShopCard(db, shop, a, req),
      buySparkShopCard(db, shop, a, req),
      buySparkShopCard(db, shop, b, { ...req, requestId: randomUUID() }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ pullId: string }>[];
    const pullIds = new Set(ok.map((r) => r.value.pullId));
    expect(pullIds.size).toBe(1);
    const pull = await db.pull.findUniqueOrThrow({ where: { id: [...pullIds][0] } });
    expect(pull.status).toBe("REVEALED");
    const balances = await db.cardbitSparkWallet.findMany({ where: { shop }, orderBy: { customerId: "asc" } });
    expect(balances.map((w) => w.balance).sort()).toEqual([300, 50]);
    expect(await sparkShopView(db, shop)).toEqual([]);
  });
});
