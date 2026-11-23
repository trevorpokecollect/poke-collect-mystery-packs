import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import type { Recipe } from "./model";
import { enabled, liveWorkspace, reviewWorkspaceEnabled } from "./mode.server";
const mocks = vi.hoisted(() => ({
  gql: vi.fn(),
  candidates: vi.fn(),
  readBook: vi.fn(),
}));
vi.mock("../lib/orders.server", () => ({ gql: mocks.gql }));
vi.mock("./sources.server", () => ({ candidates: mocks.candidates }));
vi.mock("./book.server", () => ({
  asJson: (x: unknown) => x,
  readBook: mocks.readBook,
  lockBook: vi.fn(),
}));
import { workspacePackProducts } from "./pack-products.server";
import { build, commitPool, verifyWorkspaceLaunch } from "./pools.server";
import { verifyAccount } from "./customers.server";
const admin = {} as AdminApiContext;
const variantId = "gid://shopify/ProductVariant/301",
  productId = "gid://shopify/Product/201";
const sample = {
  id: productId,
  handle: "cardbit-mystery-edition",
  title: "Mystery Edition",
  productType: "Mystery Pack",
  status: "DRAFT",
  variants: { nodes: [{ id: variantId, price: "10.00" }] },
};
const recipe: Recipe = {
  edition: "mystery",
  title: "Owner pool",
  language: "English",
  set: "",
  condition: "Near Mint",
  packs: 1,
  price: 1000,
  min: 0,
  max: 5000,
  target: 10000,
  copies: 1,
  minHits: 0,
  hit: 1000,
  tiers: ["Common", "Uncommon", "Rare", "Epic", "Legendary"].map((name, i) => ({
    name,
    min: i * 500,
  })),
};
const request = "67ba1102-4df0-4447-995f-338f84b03721";
const stock = {
  variantId: "gid://shopify/ProductVariant/901",
  productId: "gid://shopify/Product/801",
  inventoryItemId: "item",
  locationId: "loc",
  key: "101|en|holo|near mint",
  name: "Card",
  set: "Set",
  number: "3",
  language: "English",
  finish: "Holo",
  condition: "Near Mint",
  retail: 1000,
  cash: 500,
  market: null,
  retailDate: "2026-11-23",
  marketDate: null,
  quoteSource: "merchant",
  available: 1,
  image: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CARDBIT_STOREFRONT_SHOP", shop);
  vi.stubEnv("CARDBIT_WORKSPACE_MODE", "live");
  vi.stubEnv("RAILWAY_PROJECT_NAME", "cardbit-mystery-packs");
  vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
  vi.stubEnv("RAILWAY_SERVICE_NAME", "app");
  mocks.gql.mockResolvedValue({
    shop: { myshopifyDomain: shop },
    products: { nodes: [sample], pageInfo: { hasNextPage: false } },
  });
  mocks.candidates.mockResolvedValue([stock]);
});
afterEach(() => vi.unstubAllEnvs());
it("enables the owner routes only for the actual Cardbit Packs service without enabling checkout rehearsal", () => {
  expect(enabled(shop)).toBe(true);
  expect(reviewWorkspaceEnabled(shop)).toBe(false);
  expect(enabled("another.myshopify.com")).toBe(false);
  vi.stubEnv("RAILWAY_PROJECT_NAME", "card-broker");
  expect(liveWorkspace(shop)).toBe(false);
  vi.stubEnv("RAILWAY_PROJECT_NAME", "cardbit-mystery-packs");
  vi.stubEnv("RAILWAY_SERVICE_NAME", "auto-open-cron");
  expect(enabled(shop)).toBe(false);
});
it("looks up exact Cardbit products, rejects ambiguous and test packs and refuses a different authenticated store", async () => {
  mocks.gql.mockResolvedValueOnce({
    shop: { myshopifyDomain: shop },
    products: {
      pageInfo: { hasNextPage: false },
      nodes: [
        sample,
        { ...sample, handle: "cardbit-qa-five-card-test-pack" },
        {
          ...sample,
          handle: "cardbit-booster-edition",
          variants: {
            nodes: [...sample.variants.nodes, ...sample.variants.nodes],
          },
        },
        {
          ...sample,
          handle: "cardbit-gold-edition",
          productType: "Pokemon Single",
        },
      ],
    },
  });
  expect(await workspacePackProducts(admin)).toEqual({
    mystery: expect.objectContaining({ variantId, productId, price: 1000 }),
  });
  mocks.gql.mockResolvedValueOnce({
    shop: { myshopifyDomain: "other.myshopify.com" },
    products: { nodes: [sample], pageInfo: { hasNextPage: false } },
  });
  await expect(workspacePackProducts(admin)).rejects.toThrow(
    "verified on Cardbit",
  );
});
it("saves a real product-bound inventory-reserving draft, reuses a request and keeps stock changes in the native launch flow", async () => {
  const pool = {
    id: "draft1",
    handle: "cb-owner-" + request,
    title: recipe.title,
    buildRules: { cardbitRecipe: recipe },
    status: "DRAFT",
    commitHash: null,
    cards: [],
  };
  const tx = {
    $queryRaw: vi.fn(),
    card: { findMany: vi.fn().mockResolvedValue([]) },
    series: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(pool),
    },
  };
  const client = {
    series: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn((fn) => fn(tx)),
  };
  const db = client as unknown as PrismaClient;
  await build(db, admin, recipe, request);
  expect(tx.series.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        packProductId: productId,
        packVariantId: variantId,
        staffTest: false,
        reserveInventory: true,
        status: "DRAFT",
        autoOpenDays: 0,
      }),
    }),
  );
  client.series.findFirst.mockResolvedValue(pool);
  expect((await build(db, admin, recipe, request)).id).toBe(pool.id);
  expect(tx.series.create).toHaveBeenCalledTimes(1);
  await expect(commitPool(db, admin, pool.id)).rejects.toThrow("Review this draft");
  client.series.findFirst.mockResolvedValue(null);
  tx.series.findFirst.mockResolvedValue({ title: "Another draft" });
  await expect(build(db, admin, recipe, request)).rejects.toThrow(
    "already has a draft",
  );
  expect(tx.series.create).toHaveBeenCalledTimes(1);
  await expect(
    build(db, admin, { ...recipe, price: 999 }, request),
  ).rejects.toThrow("price changed");
});
it("requires a matching active merchant offer and physical inventory identifiers immediately before native launch", async () => {
  const card = {
    variantId: stock.variantId,
    marketValue: 10,
    inventoryItemId: "item",
    locationId: "loc",
  };
  const pool = {
    status: "DRAFT",
    buildRules: { cardbitRecipe: recipe },
    cards: [card],
    reserveInventory: true,
    packProductId: productId,
    packVariantId: variantId,
    packPrice: 10,
    cardsPerPack: 1,
  };
  const db = {
    series: { findFirstOrThrow: vi.fn().mockResolvedValue(pool) },
  } as unknown as PrismaClient;
  mocks.readBook.mockResolvedValue({
    variants: { [card.variantId]: stock.key },
    refs: { [stock.key]: stock },
  });
  await expect(verifyWorkspaceLaunch(db, admin, "id")).resolves.toBeUndefined();
  mocks.readBook.mockResolvedValue({
    variants: { [card.variantId]: stock.key },
    refs: { [stock.key]: { ...stock, quoteSource: "snapshot" } },
  });
  await expect(verifyWorkspaceLaunch(db, admin, "id")).rejects.toThrow(
    "current merchant price",
  );
  await expect(
    verifyAccount(admin, "gid://shopify/Customer/1", "shopper"),
  ).rejects.toThrow("Cardbit customer wallet");
});
