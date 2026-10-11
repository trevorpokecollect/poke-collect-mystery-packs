// Admin-side series management: creating a series, filling its card pool from
// Shopify variants, and launching it (which also sets the pack's inventory).
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { Prisma } from "@prisma/client";
import db from "../db.server";
import { launchSeries } from "./pool.server";
import { gql } from "./orders.server";
import { fetchCandidates, releaseUnneeded, reservePool, type CandidateFilter } from "./inventory.server";
import {
  buildPool,
  copiesAllowed,
  DEFAULT_TIER_RULES,
  normalizeTierRules,
  tierFor,
  validateBuildRules,
  type BuildRules,
  type TierRule,
} from "./pool-builder";


interface VariantNode {
  id: string;
  title: string;
  displayName: string;
  price: string;
  inventoryQuantity: number | null;
  inventoryItem: {
    id: string;
    inventoryLevels: { nodes: { location: { id: string }; quantities: { quantity: number }[] }[] };
  } | null;
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
            inventoryItem {
              id
              inventoryLevels(first: 5) { nodes { location { id } quantities(names: ["available"]) { quantity } } }
            }
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
  const inUse = await db.series.findFirst({
    where: { shop, packVariantId: variant.id, status: { in: ["DRAFT", "LIVE"] } },
  });
  if (inUse) {
    throw new Error(`That pack is already used by "${inUse.title}". Close that series first, then reuse the pack.`);
  }
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
  const series = await db.series.findUniqueOrThrow({ where: { id: seriesId } });
  const variants = await fetchVariants(admin, variantIds);
  const existing = await db.card.count({ where: { seriesId } });
  const tiers = series.tierRules ? seriesTierRules(series) : null;
  await db.card.createMany({
    skipDuplicates: true,
    data: variants.map((v, i) => {
      // Auto-built pools reserve one copy from the location holding the most stock.
      const levels = v.inventoryItem?.inventoryLevels.nodes ?? [];
      const best = [...levels].sort((a, b) => (b.quantities[0]?.quantity ?? 0) - (a.quantities[0]?.quantity ?? 0))[0];
      const reserve = series.reserveInventory && v.inventoryItem && best;
      return {
        seriesId,
        variantId: v.id,
        productId: v.product.id,
        title: cardTitle(v),
        imageUrl: variantImage(v),
        tier: tiers ? tierFor(Number(v.price), tiers) : "Base",
        marketValue: v.price,
        quantity: reserve ? 1 : Math.max(1, v.inventoryQuantity ?? 1),
        sortOrder: existing + i,
        inventoryItemId: reserve ? v.inventoryItem!.id : null,
        locationId: reserve ? best.location.id : null,
      };
    }),
  });
}

/**
 * Launches the series: shuffles and commits the pool, then sets the pack variant's
 * available inventory to the number of packs so the store can never oversell.
 */
export async function launch(admin: AdminApiContext, seriesId: string) {
  const draft = await db.series.findUniqueOrThrow({ where: { id: seriesId } });
  if (draft.reserveInventory && draft.status === "DRAFT") {
    const short = await unavailableCards(admin, seriesId);
    if (short.length > 0) {
      throw new Error(
        `${short.length} card${short.length === 1 ? " has" : "s have"} sold since the pool was built: ` +
          `${short.slice(0, 5).join(", ")}${short.length > 5 ? "…" : ""}. Rebuild the pool or remove ${short.length === 1 ? "it" : "them"}.`,
      );
    }
    await reservePool(db, admin, seriesId);
  }
  let series;
  try {
    series = await launchSeries(db, seriesId);
  } catch (error) {
    // Still a draft, so this hands every reserved copy back.
    await releaseUnneeded(db, admin, seriesId);
    throw error;
  }
  const packs = await db.slot.count({ where: { seriesId } });

  await setPackStock(admin, series.packVariantId, packs, `launch-${series.id}`);
  return { series, packs };
}

/** Sets the pack variant's available stock at its location (packs left to sell). */
export async function setPackStock(admin: AdminApiContext, packVariantId: string, quantity: number, key: string) {
  const data = await gql(
    admin,
    `#graphql
      query PackVariantInventory($id: ID!) {
        productVariant(id: $id) {
          id
          inventoryItem { id inventoryLevels(first: 1) { nodes { location { id } } } }
        }
      }`,
    { id: packVariantId },
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
      key,
      input: {
        name: "available",
        reason: "correction",
        quantities: [{ inventoryItemId: item.id, locationId, quantity, changeFromQuantity: null }],
      },
    },
  );
}

/**
 * Sets the pack's stock to the cards still left to draw. Run after refunds and cancellations:
 * a refunded or cancelled pack's card leaves the pool, so a restocked pack would otherwise be
 * one more pack than there are cards, and its buyer would get nothing.
 */
export async function syncPackStock(admin: AdminApiContext, seriesId: string) {
  const series = await db.series.findUnique({ where: { id: seriesId } });
  if (!series) return;
  const left =
    series.status === "LIVE"
      ? await db.slot.count({ where: { seriesId, claimed: false, voided: false } })
      : 0;
  await setPackStock(admin, series.packVariantId, left, `sync-${seriesId}-${left}-${Date.now()}`);
}

/** Expected market value per pack and the share of the pack price it returns. */
export function poolSummary(cards: { marketValue: { toString(): string }; quantity: number }[], packPrice: number) {
  const packs = cards.reduce((n, c) => n + c.quantity, 0);
  const totalValue = cards.reduce((n, c) => n + Number(c.marketValue.toString()) * c.quantity, 0);
  const ev = packs ? totalValue / packs : 0;
  return { packs, totalValue, ev, returnRate: packPrice ? ev / packPrice : 0, revenue: packs * packPrice };
}

export interface AutoBuildInput extends BuildRules, CandidateFilter {}

/** Tier rules saved on the series, or the defaults. */
export function seriesTierRules(series: { tierRules: unknown }): TierRule[] {
  try {
    return series.tierRules ? normalizeTierRules(series.tierRules) : DEFAULT_TIER_RULES;
  } catch {
    return DEFAULT_TIER_RULES;
  }
}

/**
 * Replaces a draft series' cards with a pool picked from live inventory, inside the value
 * range and averaging the target: one copy of each card, or up to 3 in pools over 50 cards.
 * Cards already in another draft or live series are skipped so two pools never claim the same copy.
 */
export async function autoBuildPool(admin: AdminApiContext, shop: string, seriesId: string, input: AutoBuildInput) {
  validateBuildRules(input);
  if (!input.productType.trim()) throw new Error("Choose which product type to pick cards from.");
  const series = await db.series.findFirstOrThrow({ where: { id: seriesId, shop } });
  if (series.status !== "DRAFT") throw new Error("Cards can't change after launch.");

  const inUse = new Set(
    (
      await db.card.findMany({
        where: { series: { shop, status: { in: ["DRAFT", "LIVE"] }, id: { not: seriesId } } },
        select: { variantId: true },
      })
    ).map((c) => c.variantId),
  );
  const candidates = (await fetchCandidates(admin, input)).filter((c) => !inUse.has(c.variantId));
  const { cards } = buildPool(candidates, { ...input, maxCopies: copiesAllowed(input.count) });
  const tiers = seriesTierRules(series);

  await db.$transaction([
    db.card.deleteMany({ where: { seriesId } }),
    db.card.createMany({
      data: cards.map((c, i) => ({
        seriesId,
        variantId: c.variantId,
        productId: c.productId,
        title: c.title,
        imageUrl: c.imageUrl,
        tier: tierFor(c.value, tiers),
        marketValue: c.value,
        quantity: c.quantity,
        sortOrder: i,
        inventoryItemId: c.inventoryItemId,
        locationId: c.locationId,
      })),
    }),
    db.series.update({
      where: { id: seriesId },
      data: {
        reserveInventory: true,
        tierRules: tiers as unknown as Prisma.InputJsonValue,
        buildRules: { ...input } as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);
  return cards.reduce((n, c) => n + c.quantity, 0);
}

/** Saves new tier rules and re-tiers every card in a draft series by its value. */
export async function updateTierRules(seriesId: string, rules: unknown) {
  const tiers = normalizeTierRules(rules);
  const series = await db.series.findUniqueOrThrow({ where: { id: seriesId }, include: { cards: true } });
  if (series.status !== "DRAFT") throw new Error("Tiers can't change after launch.");
  await db.$transaction([
    db.series.update({ where: { id: seriesId }, data: { tierRules: tiers as unknown as Prisma.InputJsonValue } }),
    ...series.cards.map((c) =>
      db.card.update({ where: { id: c.id }, data: { tier: tierFor(Number(c.marketValue), tiers) } }),
    ),
  ]);
}

/** Cards in the pool whose copies are no longer available to reserve (sold since the pool was built). */
async function unavailableCards(admin: AdminApiContext, seriesId: string) {
  const cards = await db.card.findMany({ where: { seriesId, inventoryItemId: { not: null } } });
  const short: string[] = [];
  for (let i = 0; i < cards.length; i += 100) {
    const batch = cards.slice(i, i + 100);
    const data = await gql(
      admin,
      `#graphql
        query PoolAvailability($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on InventoryItem {
              id
              inventoryLevels(first: 5) { nodes { location { id } quantities(names: ["available"]) { quantity } } }
            }
          }
        }`,
      { ids: batch.map((c) => c.inventoryItemId) },
    );
    const byItem = new Map<string, { location: { id: string }; quantities: { quantity: number }[] }[]>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data.nodes as any[]).filter(Boolean).map((n) => [n.id, n.inventoryLevels.nodes]),
    );
    for (const card of batch) {
      const level = byItem.get(card.inventoryItemId!)?.find((l) => l.location.id === card.locationId);
      const available = level?.quantities[0]?.quantity ?? 0;
      if (available < card.quantity - card.reservedQty) short.push(card.title);
    }
  }
  return short;
}
