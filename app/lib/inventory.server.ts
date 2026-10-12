// Shopify inventory side of auto-built pools: finding in-stock cards that match the rules,
// and moving pool cards between "available" and "reserved" so they can only be won from packs.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { Card, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { gql } from "./orders.server";

type Admin = AdminApiContext;

export interface CandidateFilter {
  productType: string;
  /** Variant option value to require, e.g. "Near Mint". Blank allows any condition. */
  condition: string;
  /** Card language(s), matched against StorePass's `Language_<name>` product tag. Comma-separate to allow several; blank allows any. */
  language: string;
}

export interface InventoryCandidate {
  variantId: string;
  productId: string;
  title: string;
  imageUrl: string | null;
  value: number;
  inventoryItemId: string;
  locationId: string;
  available: number;
}

interface VariantPage {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: {
    id: string;
    title: string;
    displayName: string;
    price: string;
    selectedOptions: { value: string }[];
    image: { url: string } | null;
    product: {
      id: string;
      title: string;
      status: string;
      productType: string;
      tags: string[];
      featuredMedia: { preview: { image: { url: string } | null } | null } | null;
    };
    inventoryItem: {
      id: string;
      tracked: boolean;
      inventoryLevels: { nodes: { location: { id: string }; quantities: { quantity: number }[] }[] };
    } | null;
  }[];
}

const PAGE_SIZE = 200;
const MAX_PAGES = 40;

const quote = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/**
 * In-stock, inventory-tracked variants of active products of one product type.
 * Shopify's variant search ignores price ranges, so the caller filters by value.
 */
export async function fetchCandidates(admin: Admin, filter: CandidateFilter): Promise<InventoryCandidate[]> {
  // "Pokemon Single, Pokemon Japanese Single" draws from either product type.
  const types = filter.productType.split(",").map((t) => t.trim()).filter(Boolean);
  const query = [
    types.length > 1 ? `(${types.map((t) => `product_type:${quote(t)}`).join(" OR ")})` : `product_type:${quote(types[0] ?? "")}`,
    "product_status:active",
    "inventory_quantity:>0",
  ].join(" AND ");
  const condition = filter.condition.trim().toLowerCase();
  // "English, Japanese" allows either language.
  const languageTags = filter.language
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean)
    .map((l) => `language_${l}`);

  const out: InventoryCandidate[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: { productVariants: VariantPage } = await gql(
      admin,
      `#graphql
        query PoolCandidates($query: String!, $first: Int!, $after: String) {
          productVariants(first: $first, after: $after, query: $query) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              title
              displayName
              price
              selectedOptions { value }
              image { url }
              product { id title status productType tags featuredMedia { preview { image { url } } } }
              inventoryItem {
                id
                tracked
                inventoryLevels(first: 5) {
                  nodes { location { id } quantities(names: ["available"]) { quantity } }
                }
              }
            }
          }
        }`,
      { query, first: PAGE_SIZE, after },
    );
    const conn: VariantPage = data.productVariants;
    for (const v of conn.nodes) {
      if (v.product.status !== "ACTIVE" || !types.includes(v.product.productType)) continue;
      if (!v.inventoryItem?.tracked) continue;
      if (languageTags.length && !v.product.tags.some((t) => languageTags.includes(t.trim().toLowerCase()))) continue;
      if (condition && !v.selectedOptions.some((o) => o.value.trim().toLowerCase() === condition)) {
        continue;
      }
      // Reserve from the location holding the most copies.
      let best: { locationId: string; available: number } | null = null;
      for (const level of v.inventoryItem.inventoryLevels.nodes) {
        const available = level.quantities[0]?.quantity ?? 0;
        if (available > 0 && (!best || available > best.available)) best = { locationId: level.location.id, available };
      }
      if (!best) continue;
      out.push({
        variantId: v.id,
        productId: v.product.id,
        title: v.title === "Default Title" ? v.product.title : v.displayName,
        imageUrl: v.image?.url ?? v.product.featuredMedia?.preview?.image?.url ?? null,
        value: Number(v.price),
        inventoryItemId: v.inventoryItem.id,
        locationId: best.locationId,
        available: best.available,
      });
    }
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return out;
}

interface Move {
  inventoryItemId: string;
  locationId: string;
  quantity: number;
}

// Each call gets a fresh idempotency key. Shopify silently skips a move whose key it has seen
// before, so reusing a key (e.g. when a pull is released, re-reserved, then released again)
// would leave a copy stuck in "reserved" while the order also commits it.
async function moveQuantities(
  admin: Admin,
  moves: Move[],
  direction: "reserve" | "release",
  ledger: string,
  idempotencyKey: string,
) {
  if (moves.length === 0) return;
  const [from, to] = direction === "reserve" ? ["available", "reserved"] : ["reserved", "available"];
  await gql(
    admin,
    `#graphql
      mutation PoolMoveInventory($input: InventoryMoveQuantitiesInput!, $key: String!) {
        inventoryMoveQuantities(input: $input) @idempotent(key: $key) {
          inventoryAdjustmentGroup { id }
          userErrors { field message }
        }
      }`,
    {
      key: idempotencyKey,
      input: {
        reason: direction === "reserve" ? "reservation_created" : "reservation_deleted",
        referenceDocumentUri: ledger,
        changes: moves.map((m) => ({
          quantity: m.quantity,
          inventoryItemId: m.inventoryItemId,
          // changeFromQuantity is required by the API; null skips the compare-and-swap check.
          from: {
            locationId: m.locationId,
            name: from,
            ledgerDocumentUri: from === "reserved" ? ledger : null,
            changeFromQuantity: null,
          },
          to: {
            locationId: m.locationId,
            name: to,
            ledgerDocumentUri: to === "reserved" ? ledger : null,
            changeFromQuantity: null,
          },
        })),
      },
    },
  );
}

const ledgerFor = (seriesId: string) => `mystery-packs://series/${seriesId}`;

function reservable(card: Card): card is Card & { inventoryItemId: string; locationId: string } {
  return !!card.inventoryItemId && !!card.locationId;
}

/** Moves every pool card's copies from available to reserved. Called just before launch. */
export async function reservePool(db: PrismaClient, admin: Admin, seriesId: string) {
  const cards = (await db.card.findMany({ where: { seriesId } })).filter(reservable);
  const todo = cards.filter((c) => c.quantity > c.reservedQty);
  // Shopify caps one move at 250 changes.
  for (let i = 0; i < todo.length; i += 250) {
    const batch = todo.slice(i, i + 250);
    await moveQuantities(
      admin,
      batch.map((c) => ({ inventoryItemId: c.inventoryItemId, locationId: c.locationId, quantity: c.quantity - c.reservedQty })),
      "reserve",
      ledgerFor(seriesId),
      `reserve-${seriesId}-${i}-${randomUUID()}`,
    );
    await db.$transaction(
      batch.map((c) => db.card.update({ where: { id: c.id }, data: { reservedQty: c.quantity } })),
    );
  }
}

/**
 * Releases one reserved copy per pull back to available, right before the won cards are
 * added to the order (the order edit then commits them). Skips pulls already released.
 */
export async function unreserveForPulls(db: PrismaClient, admin: Admin, pullIds: string[]) {
  const pulls = await db.pull.findMany({
    where: { id: { in: pullIds }, unreservedAt: null },
    include: { slot: { include: { card: true } } },
  });
  for (const pull of pulls) {
    const card = pull.slot.card;
    if (!reservable(card) || card.reservedQty <= 0) continue;
    await moveQuantities(
      admin,
      [{ inventoryItemId: card.inventoryItemId, locationId: card.locationId, quantity: 1 }],
      "release",
      ledgerFor(pull.seriesId),
      `pull-${pull.id}-${randomUUID()}`,
    );
    await db.$transaction([
      db.pull.update({ where: { id: pull.id }, data: { unreservedAt: new Date() } }),
      db.card.update({ where: { id: card.id }, data: { reservedQty: { decrement: 1 } } }),
    ]);
  }
}

/**
 * Puts a released copy back into reserved for each pull, e.g. when a vault shipment's invoice
 * lapses unpaid and the cards return to the vault. Skips pulls that were never released.
 */
export async function rereserveForPulls(db: PrismaClient, admin: Admin, pullIds: string[]) {
  const pulls = await db.pull.findMany({
    where: { id: { in: pullIds }, unreservedAt: { not: null } },
    include: { slot: { include: { card: true } } },
  });
  for (const pull of pulls) {
    const card = pull.slot.card;
    if (!reservable(card)) continue;
    await moveQuantities(
      admin,
      [{ inventoryItemId: card.inventoryItemId, locationId: card.locationId, quantity: 1 }],
      "reserve",
      ledgerFor(pull.seriesId),
      `rereserve-${pull.id}-${randomUUID()}`,
    );
    await db.$transaction([
      db.pull.update({ where: { id: pull.id }, data: { unreservedAt: null } }),
      db.card.update({ where: { id: card.id }, data: { reservedQty: { increment: 1 } } }),
    ]);
  }
}

/**
 * Returns reserved copies the series no longer needs to normal inventory: everything
 * not owed to a pack once the series is closed, including cards from voided packs.
 * Safe to call any time; a live series keeps every unclaimed copy reserved.
 */
export async function releaseUnneeded(db: PrismaClient, admin: Admin, seriesId: string) {
  const series = await db.series.findUnique({ where: { id: seriesId }, include: { cards: true } });
  if (!series) return 0;
  let released = 0;
  for (const card of series.cards.filter(reservable)) {
    if (card.reservedQty <= 0) continue;
    const owed = await db.pull.count({
      where: { slot: { cardId: card.id }, status: { in: ["UNOPENED", "REVEALED"] }, unreservedAt: null },
    });
    const unclaimed =
      series.status === "LIVE"
        ? await db.slot.count({ where: { cardId: card.id, claimed: false, voided: false } })
        : 0;
    const extra = card.reservedQty - owed - unclaimed;
    if (extra <= 0) continue;
    await moveQuantities(
      admin,
      [{ inventoryItemId: card.inventoryItemId, locationId: card.locationId, quantity: extra }],
      "release",
      ledgerFor(seriesId),
      `release-${card.id}-${randomUUID()}`,
    );
    await db.card.update({ where: { id: card.id }, data: { reservedQty: { decrement: extra } } });
    released += extra;
  }
  return released;
}

export interface InventoryIssue {
  inventoryItemId: string;
  locationId: string;
  title: string;
  onHand: number;
  available: number;
  reserved: number;
  committed: number;
  /** Copies Shopify should hold in "reserved": the pools' reservations plus open vault invoices. */
  expectedReserved: number;
  /** Reserved copies nothing in the app accounts for (usually also committed to an order). */
  stuck: number;
  ledgers: string[];
}

/**
 * Compares every pool card's Shopify inventory with what the app expects to be reserved and
 * returns the items that disagree or have gone negative. Read-only.
 */
export async function auditPoolInventory(db: PrismaClient, admin: Admin) {
  const cards = (await db.card.findMany({ where: { inventoryItemId: { not: null } } })).filter(reservable);
  // Open vault invoices hold their cards in the draft order's own reservation.
  const invoiced = await db.pull.findMany({
    where: { shipRequest: { status: "PENDING", draftOrderId: { not: null } }, unreservedAt: { not: null } },
    select: { slot: { select: { cardId: true } } },
  });
  const invoicedByCard = new Map<string, number>();
  for (const p of invoiced) invoicedByCard.set(p.slot.cardId, (invoicedByCard.get(p.slot.cardId) ?? 0) + 1);

  const groups = new Map<string, { inventoryItemId: string; locationId: string; title: string; expected: number; ledgers: Set<string> }>();
  for (const card of cards) {
    const key = `${card.inventoryItemId}|${card.locationId}`;
    const group = groups.get(key) ?? { inventoryItemId: card.inventoryItemId, locationId: card.locationId, title: card.title, expected: 0, ledgers: new Set<string>() };
    group.expected += card.reservedQty + (invoicedByCard.get(card.id) ?? 0);
    group.ledgers.add(ledgerFor(card.seriesId));
    groups.set(key, group);
  }

  const items = [...new Set(cards.map((c) => c.inventoryItemId))];
  const levels = new Map<string, Record<string, number>>();
  for (let i = 0; i < items.length; i += 50) {
    const data = await gql(
      admin,
      `#graphql
        query PoolInventoryAudit($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on InventoryItem {
              id
              inventoryLevels(first: 10) {
                nodes { location { id } quantities(names: ["available", "reserved", "committed", "on_hand"]) { name quantity } }
              }
            }
          }
        }`,
      { ids: items.slice(i, i + 50) },
    );
    for (const node of data.nodes as ({ id: string; inventoryLevels: { nodes: { location: { id: string }; quantities: { name: string; quantity: number }[] }[] } } | null)[]) {
      for (const level of node?.inventoryLevels.nodes ?? []) {
        levels.set(`${node!.id}|${level.location.id}`, Object.fromEntries(level.quantities.map((q) => [q.name, q.quantity])));
      }
    }
  }

  const issues: InventoryIssue[] = [];
  for (const [key, group] of groups) {
    const q = levels.get(key);
    if (!q) continue;
    const reserved = q.reserved ?? 0;
    const issue: InventoryIssue = {
      inventoryItemId: group.inventoryItemId,
      locationId: group.locationId,
      title: group.title,
      onHand: q.on_hand ?? 0,
      available: q.available ?? 0,
      reserved,
      committed: q.committed ?? 0,
      expectedReserved: group.expected,
      stuck: Math.max(0, reserved - group.expected),
      ledgers: [...group.ledgers],
    };
    if (issue.available < 0 || issue.stuck > 0) issues.push(issue);
  }
  issues.sort((a, b) => a.available - b.available || b.stuck - a.stuck);
  return { checked: groups.size, issues };
}

/** Releases reserved copies the app no longer accounts for back to available. Returns copies released. */
export async function repairStuckReservations(db: PrismaClient, admin: Admin) {
  const { issues } = await auditPoolInventory(db, admin);
  let released = 0;
  for (const issue of issues.filter((i) => i.stuck > 0)) {
    // The stuck copy sits under one of the pools' ledgers; try each until Shopify accepts the move.
    for (const ledger of issue.ledgers) {
      try {
        await moveQuantities(
          admin,
          [{ inventoryItemId: issue.inventoryItemId, locationId: issue.locationId, quantity: issue.stuck }],
          "release",
          ledger,
          `repair-${issue.inventoryItemId}-${randomUUID()}`,
        );
        released += issue.stuck;
        break;
      } catch (error) {
        console.error(`Repair via ${ledger} failed for ${issue.title}`, error);
      }
    }
  }
  return released;
}
