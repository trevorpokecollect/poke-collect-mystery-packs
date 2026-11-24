import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { gql } from "../lib/orders.server";
import { readBook } from "./book.server";
import { details, draftRevision } from "./pools.server";
import { launchWalletPool } from "./launch.server";
import { dailySpin, SPIN_TABLE_KEY } from "../lib/cardbit-spinner.server";
import { sparkShopView } from "../lib/cardbit-spark-shop.server";
import { walletView } from "../lib/cardbits.server";
vi.mock("../lib/orders.server", () => ({ gql: vi.fn() }));
vi.mock("./book.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./book.server")>();
  return { ...actual, readBook: vi.fn() };
});
const url = process.env.TEST_DATABASE_URL, admin = {} as AdminApiContext;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/disabled_test" } } });
const single = "gid://shopify/ProductVariant/5420";
const winner = "gid://shopify/Customer/5501";

describe.skipIf(!url)("prize pools launch with a physical reservation and feed the spinner and Spark Shop", () => {
  const ids: string[] = [];
  beforeAll(async () => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
    vi.stubEnv("CARDBIT_STOREFRONT_SHOP", shop);
    vi.stubEnv("CARDBIT_WORKSPACE_MODE", "live");
    vi.stubEnv("RAILWAY_PROJECT_NAME", "cardbit-mystery-packs");
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
    vi.stubEnv("RAILWAY_SERVICE_NAME", "app");
    vi.stubEnv("CARDBIT_SPINNER", "on");
    vi.stubEnv("CARDBIT_SPARKS", "on");
    vi.mocked(readBook).mockResolvedValue({
      variants: { [single]: "one" },
      refs: { one: { retail: 150, cash: 50, quoteSource: "merchant" } },
      policy: { bands: [] },
    } as unknown as Awaited<ReturnType<typeof readBook>>);
    await db.appValue.upsert({
      where: { key: SPIN_TABLE_KEY },
      create: { key: SPIN_TABLE_KEY, value: JSON.stringify({ basic: [{ kind: "card", weight: 1 }, { kind: "xp", amount: 10, weight: 0 }] }) },
      update: { value: JSON.stringify({ basic: [{ kind: "card", weight: 1 }, { kind: "xp", amount: 10, weight: 0 }] }) },
    });
  });
  afterAll(async () => {
    await db.cardbitSpin.deleteMany({ where: { shop } });
    await db.pull.deleteMany({ where: { shop, seriesId: { in: ids } } });
    await db.packOrder.deleteMany({ where: { shop, orderId: { startsWith: "cardbit-spin:" } } });
    await db.cardbitLaunchBatch.deleteMany({ where: { seriesId: { in: ids } } });
    await db.series.deleteMany({ where: { id: { in: ids } } });
    await db.cardbitXpEvent.deleteMany({ where: { shop } });
    await db.cardbitProfile.deleteMany({ where: { shop } });
    await db.appValue.deleteMany({ where: { key: SPIN_TABLE_KEY } });
    vi.unstubAllEnvs();
    await db.$disconnect();
  });
  async function prizeDraft(prize: "spin-basic" | "spark-shop", item: string) {
    const flags = prize === "spark-shop" ? { cardbitSparkShop: true } : { cardbitDailySpin: "basic" };
    const d = await db.series.create({
      data: {
        shop, title: "Prize " + prize, handle: "cb-owner-" + randomUUID(), reserveInventory: true,
        packProductId: "cardbit-prize", packVariantId: "cardbit-prize:" + prize, packPrice: 10, cardsPerPack: 1,
        buildRules: { cardbitRecipe: { price: 1000, edition: "mystery", prize }, cardbitSalesChannel: "prize", ...flags },
        cards: { create: { variantId: single, productId: "gid://shopify/Product/50", title: "Prize Card", tier: "Base", quantity: 1, marketValue: 1.5, inventoryItemId: item, locationId: "location" } },
      },
      include: details,
    });
    ids.push(d.id);
    return d;
  }
  function inventory() {
    const docs: string[] = [];
    vi.mocked(gql).mockImplementation(async (_a, doc) => {
      docs.push(doc);
      if (doc.includes("RereserveAvailable"))
        return { nodes: ["spin-item", "shop-item"].map((id) => ({ id, inventoryLevels: { nodes: [{ location: { id: "location" }, quantities: [{ quantity: 1 }] }] } })) };
      if (doc.includes("PoolMoveInventory")) return {};
      throw Error("Unexpected Shopify call: " + doc.slice(0, 60));
    });
    return docs;
  }

  it("reserves the copy, launches without a pack product, and is never offered as a pack", async () => {
    const docs = inventory();
    const spin = await prizeDraft("spin-basic", "spin-item");
    const launched = await launchWalletPool(db, admin, spin.id, draftRevision(spin));
    expect(launched.commit).toMatch(/^[a-f0-9]{64}$/);
    expect(launched.prize).toBe("spin-basic");
    expect(docs.some((d) => d.includes("WalletPackChannel") || d.includes("WorkspacePackProducts"))).toBe(false);
    expect(docs.some((d) => d.includes("PoolMoveInventory"))).toBe(true);
    const row = await db.series.findUniqueOrThrow({ where: { id: spin.id } });
    expect(row.buildRules).toMatchObject({ cardbitSalesChannel: "prize", cardbitDailySpin: "basic" });
    expect((await db.card.findFirstOrThrow({ where: { seriesId: spin.id } })).reservedQty).toBe(1);
    const view = await walletView(db, shop, winner);
    expect((view as { packs?: { id: string }[] }).packs?.some((p) => p.id === spin.id)).toBeFalsy();

    const result = await dailySpin(db, shop, winner, new Date("2026-11-24T18:00:00Z"));
    expect(result.prizeKind).toBe("card");
    const pull = await db.pull.findUniqueOrThrow({ where: { id: result.pullId! } });
    expect(pull).toMatchObject({ seriesId: spin.id, customerId: winner, status: "REVEALED" });
  });

  it("launches a Spark Shop pool that lists in Sparks only", async () => {
    inventory();
    const shopPool = await prizeDraft("spark-shop", "shop-item");
    await launchWalletPool(db, admin, shopPool.id, draftRevision(shopPool));
    const cards = await sparkShopView(db, shop);
    expect(cards).toEqual([expect.objectContaining({ title: "Prize Card", sparks: 1000, remaining: 1 })]);
  });
});
