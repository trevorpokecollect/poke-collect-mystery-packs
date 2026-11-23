import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { gql } from "../lib/orders.server";
import { readBook } from "./book.server";
import { details, draftRevision } from "./pools.server";
import { discardWalletDraft, launchWalletPool } from "./launch.server";
vi.mock("../lib/orders.server", () => ({ gql: vi.fn() }));
vi.mock("./book.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./book.server")>();
  return { ...actual, readBook: vi.fn() };
});
const url = process.env.TEST_DATABASE_URL,
  admin = {} as AdminApiContext;
const db = new PrismaClient({
  datasources: { db: { url: url || "postgresql://localhost/disabled_test" } },
});
const product = "gid://shopify/Product/3411",
  variant = "gid://shopify/ProductVariant/3412",
  single = "gid://shopify/ProductVariant/3420";
describe.skipIf(!url)(
  "physical Cardbit launch and recovery on disposable Postgres",
  () => {
    const drafts: string[] = [];
    beforeAll(() => {
      execFileSync("npx", ["prisma", "migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: url },
        stdio: "ignore",
      });
      vi.stubEnv("CARDBIT_STOREFRONT_SHOP", shop);
      vi.stubEnv("CARDBIT_WORKSPACE_MODE", "live");
      vi.stubEnv("RAILWAY_PROJECT_NAME", "cardbit-mystery-packs");
      vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
      vi.stubEnv("RAILWAY_SERVICE_NAME", "app");
      vi.mocked(readBook).mockResolvedValue({
        variants: { [single]: "one" },
        refs: { one: { retail: 1000, cash: 500, quoteSource: "merchant" } },
      } as unknown as Awaited<ReturnType<typeof readBook>>);
    });
    afterAll(async () => {
      await db.cardbitLaunchBatch.deleteMany({
        where: { seriesId: { in: drafts } },
      });
      await db.series.deleteMany({ where: { id: { in: drafts } } });
      vi.unstubAllEnvs();
      await db.$disconnect();
    });
    async function draft() {
      const d = await db.series.create({
        data: {
          shop,
          title: "Reserved draft",
          handle: "cb-owner-" + randomUUID(),
          reserveInventory: true,
          packProductId: product,
          packVariantId: variant,
          packPrice: 10,
          cardsPerPack: 1,
          buildRules: {
            cardbitRecipe: { price: 1000, edition: "mystery" },
            cardbitSalesChannel: "wallet",
          },
          cards: {
            create: {
              variantId: single,
              productId: "gid://shopify/Product/30",
              title: "Card",
              tier: "Base",
              quantity: 2,
              marketValue: 10,
              inventoryItemId: "item",
              locationId: "location",
            },
          },
        },
        include: details,
      });
      drafts.push(d.id);
      return d;
    }
    function inventory() {
      let available = 2,
        reserved = 0,
        lost = true;
      const executed = new Set<string>();
      vi.mocked(gql).mockImplementation(async (_admin, doc, variables) => {
        if (doc.includes("WorkspacePackProducts"))
          return {
            shop: { myshopifyDomain: shop },
            products: {
              pageInfo: { hasNextPage: false },
              nodes: [
                {
                  id: product,
                  handle: "cardbit-mystery-edition",
                  title: "Mystery",
                  productType: "Mystery Pack",
                  status: "ACTIVE",
                  variants: { nodes: [{ id: variant, price: "10.00" }] },
                },
              ],
            },
          };
        if (doc.includes("WalletPackChannel"))
          return {
            productVariant: {
              inventoryPolicy: "DENY",
              inventoryItem: {
                tracked: true,
                inventoryLevels: {
                  pageInfo: { hasNextPage: false },
                  nodes: [{ quantities: [{ quantity: 0 }] }],
                },
              },
            },
          };
        if (doc.includes("RereserveAvailable"))
          return {
            nodes: [
              {
                id: "item",
                inventoryLevels: {
                  nodes: [
                    {
                      location: { id: "location" },
                      quantities: [{ quantity: available }],
                    },
                  ],
                },
              },
            ],
          };
        if (!doc.includes("PoolMoveInventory"))
          throw Error("Unexpected inventory operation");
        const key = String(variables?.key);
        if (!executed.has(key)) {
          if (key.startsWith("cb-release-")) {
            available += 2;
            reserved -= 2;
          } else {
            expect(available).toBe(2);
            available -= 2;
            reserved += 2;
          }
          executed.add(key);
          if (lost) {
            lost = false;
            throw Error("Response lost");
          }
        }
        return {};
      });
      return () => ({ available, reserved, moves: executed.size });
    }
    it("discards a partially reserved draft after a lost response and restores exactly its physical copies", async () => {
      const d = await draft(),
        stock = inventory();
      await expect(
        launchWalletPool(db, admin, d.id, "0".repeat(64)),
      ).rejects.toThrow("draft changed");
      await expect(
        launchWalletPool(db, admin, d.id, draftRevision(d)),
      ).rejects.toThrow("Response lost");
      await discardWalletDraft(db, admin, d.id);
      expect(stock()).toEqual({ available: 2, reserved: 0, moves: 2 });
      expect(await db.series.findUnique({ where: { id: d.id } })).toBeNull();
    });
    it("recovers a lost Shopify response, serializes two launches and produces just one fairness commitment", async () => {
      const d = await draft(),
        revision = draftRevision(d),
        stock = inventory();
      await expect(launchWalletPool(db, admin, d.id, revision)).rejects.toThrow(
        "Response lost",
      );
      const a = await launchWalletPool(db, admin, d.id, revision);
      const b = await launchWalletPool(db, admin, d.id, revision);
      expect(a.commit).toMatch(/^[a-f0-9]{64}$/);
      expect(a.commit).toBe(b.commit);
      expect(stock()).toEqual({ available: 0, reserved: 2, moves: 1 });
      expect(await db.slot.count({ where: { seriesId: d.id } })).toBe(2);
      expect(
        (await db.card.findFirstOrThrow({ where: { seriesId: d.id } }))
          .reservedQty,
      ).toBe(2);
    });
  },
);
