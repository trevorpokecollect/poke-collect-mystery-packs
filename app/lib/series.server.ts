// Admin-side series management: creating a series, filling its card pool from
// Shopify variants, and launching it (which also sets the pack's inventory).
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { launchSeries } from "./pool.server";
import { gql } from "./orders.server";


interface VariantNode {
  id: string;
  title: string;
  displayName: string;
  price: string;
  inventoryQuantity: number | null;
  media: { nodes: { preview: { image: { url: string } | null } | null }[] };
  product: { id: string; title: string; featuredMedia: { preview: { image: { url: string } | null } | null } | null };
}

export async function fetchVariants(admin: AdminApiContext, ids: string[]): Promise<VariantNode[]> {
  if (ids.length === 0) return [];
  const data = await gql(
    admin,
    `#graphql
      query PackVariants($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            title
            displayName
            price
            inventoryQuantity
            media(first: 1) { nodes { preview { image { url } } } }
            product { id title featuredMedia { preview { image { url } } } }
          }
        }
      }`,
    { ids },
  );
  return (data.nodes as (VariantNode | null)[]).filter((n): n is VariantNode => !!n?.id);
}

function variantImage(v: VariantNode) {
  return v.media.nodes[0]?.preview?.image?.url ?? v.product.featuredMedia?.preview?.image?.url ?? null;
}

function cardTitle(v: VariantNode) {
  return v.title === "Default Title" ? v.product.title : v.displayName;
}

export function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function createSeries(
  admin: AdminApiContext,
  shop: string,
  input: { title: string; packVariantId: string; autoOpenDays: number },
) {
  const [variant] = await fetchVariants(admin, [input.packVariantId]);
  if (!variant) throw new Error("That pack product variant wasn't found.");
  return db.series.create({
    data: {
      shop,
      title: input.title,
      handle: slugify(input.title),
      packProductId: variant.product.id,
      packVariantId: variant.id,
      packPrice: variant.price,
      autoOpenDays: input.autoOpenDays,
    },
  });
}

/** Adds picked variants to the pool with default tier, value (its price) and quantity (its stock). */
export async function addCards(admin: AdminApiContext, seriesId: string, variantIds: string[]) {
  const variants = await fetchVariants(admin, variantIds);
  const existing = await db.card.count({ where: { seriesId } });
  await db.card.createMany({
    skipDuplicates: true,
    data: variants.map((v, i) => ({
      seriesId,
      variantId: v.id,
      productId: v.product.id,
      title: cardTitle(v),
      imageUrl: variantImage(v),
      tier: "Base",
      marketValue: v.price,
      quantity: Math.max(1, v.inventoryQuantity ?? 1),
      sortOrder: existing + i,
    })),
  });
}

/**
 * Launches the series: shuffles and commits the pool, then sets the pack variant's
 * available inventory to the number of packs so the store can never oversell.
 */
export async function launch(admin: AdminApiContext, seriesId: string) {
  const series = await launchSeries(db, seriesId);
  const packs = await db.slot.count({ where: { seriesId } });

  const data = await gql(
    admin,
    `#graphql
      query PackVariantInventory($id: ID!) {
        productVariant(id: $id) {
          id
          inventoryItem { id inventoryLevels(first: 1) { nodes { location { id } } } }
        }
      }`,
    { id: series.packVariantId },
  );
  const item = data.productVariant?.inventoryItem;
  const locationId = item?.inventoryLevels.nodes[0]?.location.id;
  if (!item || !locationId) {
    throw new Error("The pack product needs inventory tracking at a location before launch.");
  }
  await gql(
    admin,
    `#graphql
      mutation PackSetInventory($input: InventorySetQuantitiesInput!, $key: String!) {
        inventorySetQuantities(input: $input) @idempotent(key: $key) {
          inventoryAdjustmentGroup { id }
          userErrors { field message }
        }
      }`,
    {
      key: `launch-${series.id}`,
      input: {
        name: "available",
        reason: "correction",
        quantities: [{ inventoryItemId: item.id, locationId, quantity: packs, changeFromQuantity: null }],
      },
    },
  );
  return { series, packs };
}

/** Expected market value per pack and the share of the pack price it returns. */
export function poolSummary(cards: { marketValue: { toString(): string }; quantity: number }[], packPrice: number) {
  const packs = cards.reduce((n, c) => n + c.quantity, 0);
  const totalValue = cards.reduce((n, c) => n + Number(c.marketValue.toString()) * c.quantity, 0);
  const ev = packs ? totalValue / packs : 0;
  return { packs, totalValue, ev, returnRate: packPrice ? ev / packPrice : 0, revenue: packs * packPrice };
}
