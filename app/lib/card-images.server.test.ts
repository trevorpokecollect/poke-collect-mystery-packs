// Runs against a real Postgres (TEST_DATABASE_URL), like pool.server.test.ts.
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fillMissingCardImages } from "./card-images.server";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("Set TEST_DATABASE_URL to an empty Postgres database to run these tests.");

const db = new PrismaClient({ datasources: { db: { url } } });
const SHOP = "images-shop.myshopify.com";

beforeAll(() => {
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
});
afterAll(() => db.$disconnect());
beforeEach(async () => {
  await db.wishItem.deleteMany({ where: { shop: SHOP } });
  await db.series.deleteMany({ where: { shop: SHOP } });
});

/** Fake Admin API: answers the nodes query from a product id → image url map. */
function adminWith(images: Record<string, string | null>) {
  const asked: string[][] = [];
  const admin = {
    graphql: async (_q: string, { variables }: { variables: { ids: string[] } }) => {
      asked.push(variables.ids);
      const nodes = variables.ids.map((id) =>
        id in images ? { id, featuredMedia: images[id] ? { preview: { image: { url: images[id] } } } : null } : null,
      );
      return new Response(JSON.stringify({ data: { nodes } }));
    },
  } as unknown as AdminApiContext;
  return { admin, asked };
}

async function seriesWith(cards: { n: number; imageUrl: string | null }[]) {
  return db.series.create({
    data: {
      shop: SHOP, cardsPerPack: 1, title: "s", handle: `s-${Math.random()}`, packProductId: "gid://shopify/Product/1",
      packVariantId: "gid://shopify/ProductVariant/1", packPrice: 10,
      cards: { create: cards.map((c) => ({ variantId: `gid://shopify/ProductVariant/${c.n}`, productId: `gid://shopify/Product/${c.n}`, title: `Card ${c.n}`, tier: "Base", marketValue: 5, quantity: 1, imageUrl: c.imageUrl })) },
    },
  });
}

describe("fillMissingCardImages", () => {
  it("fills blank card images from Shopify and never replaces an existing one", async () => {
    await seriesWith([{ n: 1, imageUrl: null }, { n: 2, imageUrl: "https://old/2.jpg" }, { n: 3, imageUrl: null }]);
    await db.wishItem.create({ data: { shop: SHOP, customerId: "c1", variantId: "gid://shopify/ProductVariant/1", title: "Card 1" } });
    const { admin, asked } = adminWith({ "gid://shopify/Product/1": "https://new/1.jpg", "gid://shopify/Product/2": "https://new/2.jpg", "gid://shopify/Product/3": null });

    const r = await fillMissingCardImages(db, async () => admin);

    expect(r.filled).toBe(1);
    expect(asked.flat().sort()).toEqual(["gid://shopify/Product/1", "gid://shopify/Product/3"]); // only blank cards are looked up
    const cards = await db.card.findMany({ where: { series: { shop: SHOP } }, orderBy: { variantId: "asc" } });
    expect(cards.map((c) => c.imageUrl)).toEqual(["https://new/1.jpg", "https://old/2.jpg", null]);
    expect((await db.wishItem.findFirst({ where: { shop: SHOP } }))?.imageUrl).toBe("https://new/1.jpg");
  });

  it("keeps the job going when Shopify fails", async () => {
    await seriesWith([{ n: 4, imageUrl: null }]);
    const r = await fillMissingCardImages(db, async () => { throw new Error("no session"); });
    expect(r.filled).toBe(0);
  });
});
