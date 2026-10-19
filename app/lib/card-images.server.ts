import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { gql } from "./orders.server";

// A card keeps the image its Shopify product had when it joined a pool, and the opener, vault, My Pulls, Recent Pulls
// and Vault Market all read that copy. Cards added while the listing had no photo stayed blank after the photo was
// added in Shopify (Meloetta ex 44, 2026-10-19), so the scheduled job fills them in from the product's current image.
// Only blank images are filled: an image a card already has is never replaced.

const MAX_PRODUCTS = 250; // per shop per run; listings that still have no photo are asked about again next run
const PAGE = 100;

export async function fillMissingCardImages(db: PrismaClient, adminFor: (shop: string) => Promise<AdminApiContext>) {
  const blank = await db.card.findMany({
    where: { imageUrl: null },
    select: { productId: true, variantId: true, series: { select: { shop: true } } },
  });
  const byShop = new Map<string, Set<string>>();
  for (const c of blank) {
    const ids = byShop.get(c.series.shop) ?? new Set<string>();
    ids.add(c.productId);
    byShop.set(c.series.shop, ids);
  }
  let filled = 0;
  for (const [shop, ids] of byShop) {
    try {
      const admin = await adminFor(shop);
      const productIds = [...ids].slice(0, MAX_PRODUCTS);
      for (let i = 0; i < productIds.length; i += PAGE) {
        const data = await gql<{ nodes: ({ id: string; featuredMedia: { preview: { image: { url: string } | null } | null } | null } | null)[] }>(
          admin,
          `#graphql
            query CardProductImages($ids: [ID!]!) {
              nodes(ids: $ids) { ... on Product { id featuredMedia { preview { image { url } } } } }
            }`,
          { ids: productIds.slice(i, i + PAGE) },
        );
        for (const node of data.nodes) {
          const url = node?.featuredMedia?.preview?.image?.url;
          if (!node?.id || !url) continue;
          const cards = await db.card.updateMany({ where: { productId: node.id, imageUrl: null, series: { shop } }, data: { imageUrl: url } });
          filled += cards.count;
        }
      }
      // Wishlist entries copy the card image when they're added, so fill theirs from the cards too.
      const wishes = await db.wishItem.findMany({ where: { shop, imageUrl: null }, select: { id: true, variantId: true } });
      for (const w of wishes) {
        const card = await db.card.findFirst({ where: { variantId: w.variantId, imageUrl: { not: null }, series: { shop } }, select: { imageUrl: true } });
        if (card) await db.wishItem.update({ where: { id: w.id }, data: { imageUrl: card.imageUrl } });
      }
    } catch (error) {
      console.error(`Filling card images for ${shop} failed`, error);
    }
  }
  return { filled };
}
