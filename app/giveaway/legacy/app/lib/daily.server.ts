import { randomInt } from "node:crypto";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { Campaign, DailyPrize, DailyPrizeStatus } from "@prisma/client";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  addDays,
  periodFor,
  pickPrize,
  sourceTypes,
  type Candidate,
  type DailySettings,
  type StockSource,
} from "./daily";
import { queueFor, upcomingPlan } from "./daily-queue.server";
import {
  bundleTitle,
  bundleValue,
  prizeItems,
  publicItems,
  type BundlePart,
  type PrizeItem,
} from "./bundles";
import { drawWinners, newSeed, snapshotHash } from "./draw";
import { enteredToday, onlyFullyEntered } from "./entries/ledger.server";
import { parseSettings } from "./settings";
import { emitWebhook } from "./webhook-out.server";
import { emailDrawWinners, storefrontUrl } from "./winners.server";
import { DAY_MS, publicName } from "./winners";

// The daily draw. For every live giveaway with settings.daily on, each day gets one prize
// picked from Shopify inventory (by the daily rules) and one unit is moved from "available"
// to "reserved" so it can't sell. At the draw time, one winner is drawn from the entries
// earned that day; the unit stays reserved until the prize is marked sent. A small in-process
// scheduler runs this every minute; POST /jobs/daily runs it on demand.

type Admin = AdminApiContext;

async function gql<T>(
  admin: Admin,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await admin.graphql(query, { variables });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors)
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
  for (const payload of Object.values(json.data ?? {})) {
    const errors = (payload as { userErrors?: { message: string }[] } | null)
      ?.userErrors;
    if (errors?.length)
      throw new Error(errors.map((e) => e.message).join("; "));
  }
  return json.data as T;
}

export const dailySettings = (campaign: Pick<Campaign, "settings">) =>
  parseSettings(campaign.settings).daily;

// ── Inventory ───────────────────────────────────────────────────────────────

interface VariantPage {
  productVariants: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      id: string;
      title: string;
      displayName: string;
      price: string;
      image: { url: string } | null;
      product: {
        id: string;
        title: string;
        handle: string;
        status: string;
        productType: string;
        tags: string[];
        featuredMedia: {
          preview: { image: { url: string } | null } | null;
        } | null;
      };
      inventoryItem: {
        id: string;
        tracked: boolean;
        inventoryLevels: {
          nodes: {
            location: { id: string };
            quantities: { name: string; quantity: number }[];
          }[];
        };
      } | null;
    }[];
  };
}

const quote = (s: string) =>
  `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** In-stock, inventory-tracked variants of active products of the daily product types. */
export async function fetchCandidates(
  admin: Admin,
  cfg: DailySettings,
  opts: { productId?: string; safetyStock?: boolean } = {},
): Promise<Candidate[]> {
  const types = sourceTypes(cfg);
  if (!types.length && !opts.productId) return [];
  const query = [
    opts.productId
      ? `product_id:${opts.productId.split("/").pop()}`
      : `(${types.map((t) => `product_type:${quote(t)}`).join(" OR ")})`,
    "product_status:active",
    // Safety stock isn't in the searchable quantity, so those are checked per variant.
    ...(opts.safetyStock ? [] : ["inventory_quantity:>0"]),
  ].join(" AND ");

  const out: Candidate[] = [];
  let after: string | null = null;
  for (let page = 0; page < 25; page++) {
    const data: VariantPage = await gql<VariantPage>(
      admin,
      `#graphql
        query DailyCandidates($query: String!, $after: String) {
          productVariants(first: 200, after: $after, query: $query) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              title
              displayName
              price
              image { url }
              product {
                id title handle status productType tags
                featuredMedia { preview { image { url } } }
              }
              inventoryItem {
                id
                tracked
                inventoryLevels(first: 5) {
                  nodes { location { id } quantities(names: ["available", "safety_stock"]) { name quantity } }
                }
              }
            }
          }
        }`,
      { query, after },
    );
    for (const v of data.productVariants.nodes) {
      if (v.product.status !== "ACTIVE" || !v.inventoryItem?.tracked) continue;
      // Reserve from the location holding the most available copies, else (when allowed)
      // the most safety stock.
      const best =
        mostStock(v.inventoryItem.inventoryLevels.nodes, "available") ??
        (opts.safetyStock
          ? mostStock(v.inventoryItem.inventoryLevels.nodes, "safety_stock")
          : null);
      if (!best) continue;
      out.push({
        variantId: v.id,
        productId: v.product.id,
        productHandle: v.product.handle,
        productType: v.product.productType,
        tags: v.product.tags,
        title: v.title === "Default Title" ? v.product.title : v.displayName,
        imageUrl:
          v.image?.url ?? v.product.featuredMedia?.preview?.image?.url ?? null,
        value: Number(v.price),
        inventoryItemId: v.inventoryItem.id,
        locationId: best.locationId,
        available: best.available,
        source: best.source,
      });
    }
    if (!data.productVariants.pageInfo.hasNextPage) break;
    after = data.productVariants.pageInfo.endCursor;
  }
  return out;
}

function mostStock(
  levels: {
    location: { id: string };
    quantities: { name: string; quantity: number }[];
  }[],
  source: StockSource,
) {
  let best: {
    locationId: string;
    available: number;
    source: StockSource;
  } | null = null;
  for (const level of levels) {
    const n = level.quantities.find((q) => q.name === source)?.quantity ?? 0;
    if (n > 0 && (!best || n > best.available))
      best = { locationId: level.location.id, available: n, source };
  }
  return best;
}

/** Variants with available stock first, then the most copies. */
const byStock = (a: Candidate, b: Candidate) =>
  Number(b.source === "available") - Number(a.source === "available") ||
  b.available - a.available;

const ledgerFor = (prize: { campaignId: string; id: string }) =>
  `poke-collect-giveaways://daily/${prize.campaignId}/${prize.id}`;

/** One reserved line of a prize: the whole prize, or one product of a bundle. */
interface Line {
  inventoryItemId: string;
  locationId: string;
  reservedFrom: string;
  quantity: number;
  /** Idempotency-key suffix: "" for single prizes (as before), "-<n>" per bundle line. */
  key: string;
}

/** The lines to reserve, release or remove for a prize. */
function linesOf(
  prize: Pick<
    DailyPrize,
    "inventoryItemId" | "locationId" | "reservedFrom" | "items"
  >,
): Line[] {
  const items = prizeItems(prize.items);
  return items
    ? items.map((i, n) => ({ ...i, key: `-${n}` }))
    : [{ ...prize, quantity: 1, key: "" }];
}

/** Moves a prize's units between reserved and where they came from (available or safety stock). */
async function moveOne(
  admin: Admin,
  prize: Pick<
    DailyPrize,
    | "id"
    | "campaignId"
    | "inventoryItemId"
    | "locationId"
    | "reservedFrom"
    | "items"
  >,
  direction: "reserve" | "release",
) {
  const lines = linesOf(prize);
  const done: Line[] = [];
  try {
    for (const line of lines) {
      await moveLine(admin, prize, line, direction);
      done.push(line);
    }
  } catch (err) {
    // A bundle that can't be fully reserved puts back what it already took.
    if (direction === "reserve")
      for (const line of done)
        await moveLine(admin, prize, line, "release").catch(() => {});
    throw err;
  }
}

async function moveLine(
  admin: Admin,
  prize: Pick<DailyPrize, "id" | "campaignId">,
  line: Line,
  direction: "reserve" | "release",
) {
  const [from, to] =
    direction === "reserve"
      ? [line.reservedFrom, "reserved"]
      : ["reserved", line.reservedFrom];
  const ledger = ledgerFor(prize);
  await gql(
    admin,
    `#graphql
      mutation DailyMoveInventory($input: InventoryMoveQuantitiesInput!, $key: String!) {
        inventoryMoveQuantities(input: $input) @idempotent(key: $key) {
          inventoryAdjustmentGroup { id }
          userErrors { field message }
        }
      }`,
    {
      key: `daily-${direction}-${prize.id}${line.key}`,
      input: {
        reason:
          direction === "reserve"
            ? "reservation_created"
            : "reservation_deleted",
        referenceDocumentUri: ledger,
        changes: [
          {
            quantity: line.quantity,
            inventoryItemId: line.inventoryItemId,
            from: {
              locationId: line.locationId,
              name: from,
              // Shopify wants a ledger document for every quantity name except "available"
              // (reserved and safety_stock both need one).
              ledgerDocumentUri: from === "available" ? null : ledger,
              changeFromQuantity: null,
            },
            to: {
              locationId: line.locationId,
              name: to,
              ledgerDocumentUri: to === "available" ? null : ledger,
              changeFromQuantity: null,
            },
          },
        ],
      },
    },
  );
}

/** Takes the sent prize out of stock: releases the reservation, then removes the units. */
async function removeOne(admin: Admin, prize: DailyPrize) {
  for (const line of linesOf(prize)) {
    await moveLine(admin, prize, line, "release");
    await removeLine(admin, prize, line);
  }
}

async function removeLine(admin: Admin, prize: DailyPrize, line: Line) {
  await gql(
    admin,
    `#graphql
      mutation DailyPrizeSent($input: InventoryAdjustQuantitiesInput!, $key: String!) {
        inventoryAdjustQuantities(input: $input) @idempotent(key: $key) {
          inventoryAdjustmentGroup { id }
          userErrors { field message }
        }
      }`,
    {
      key: `daily-sent-${prize.id}${line.key}`,
      input: {
        name: line.reservedFrom,
        reason: "promotion",
        referenceDocumentUri: ledgerFor(prize),
        changes: [
          {
            delta: -line.quantity,
            inventoryItemId: line.inventoryItemId,
            locationId: line.locationId,
            ledgerDocumentUri:
              line.reservedFrom === "available" ? null : ledgerFor(prize),
            changeFromQuantity: null,
          },
        ],
      },
    },
  );
}

// ── Prizes ──────────────────────────────────────────────────────────────────

/** Products used as a daily prize in the last `days` days (swapped-out picks don't count). */
async function recentProducts(campaignId: string, days: number) {
  const rows = await db.dailyPrize.findMany({
    where: {
      campaignId,
      createdAt: { gte: new Date(Date.now() - days * DAY_MS) },
      OR: [{ status: { not: "RELEASED" } }, { drawId: { not: null } }],
    },
    select: { productId: true },
  });
  return new Set(rows.map((r) => r.productId));
}

/**
 * Finds stock for every product of a queued bundle: per product, the variant with enough units
 * at one location (available first, then safety stock). Reports the first product that's short.
 */
async function bundleFor(
  admin: Admin,
  cfg: DailySettings,
  parts: BundlePart[],
): Promise<{ items: PrizeItem[] } | { short: string }> {
  const items: PrizeItem[] = [];
  for (const part of parts) {
    const variants = await fetchCandidates(admin, cfg, {
      productId: part.productId,
      safetyStock: true,
    });
    const v = variants
      .filter((c) => c.available >= part.quantity)
      .sort(byStock)[0];
    if (!v)
      return {
        short:
          part.quantity > 1 ? `${part.quantity}x ${part.title}` : part.title,
      };
    items.push({
      productId: v.productId,
      variantId: v.variantId,
      productHandle: v.productHandle,
      title: v.title,
      imageUrl: v.imageUrl ?? part.imageUrl,
      value: v.value,
      inventoryItemId: v.inventoryItemId,
      locationId: v.locationId,
      reservedFrom: v.source,
      quantity: part.quantity,
    });
  }
  return { items };
}

/** The prize for the period containing `now`, if one is picked and still held. */
export async function currentPrize(campaign: Campaign, now = new Date()) {
  const cfg = dailySettings(campaign);
  if (!cfg.enabled) return null;
  const period = periodFor(now, campaign.timezone, cfg.drawTime);
  const prize = await db.dailyPrize.findFirst({
    where: {
      campaignId: campaign.id,
      periodKey: period.key,
      status: { in: ["RESERVED", "DRAWN", "SENT"] },
    },
    orderBy: { createdAt: "desc" },
  });
  return { period, prize };
}

/**
 * Picks and reserves a prize for the current period if it doesn't have one yet.
 * `exclude` keeps a product out of this pick (used when swapping).
 */
export async function ensurePrize(
  campaign: Campaign,
  admin: Admin,
  opts: { exclude?: string; now?: Date; productId?: string } = {},
) {
  const cfg = dailySettings(campaign);
  if (!cfg.enabled) return null;
  const now = opts.now ?? new Date();
  const period = periodFor(now, campaign.timezone, cfg.drawTime);
  // Nothing to give away once the giveaway is over before this draw.
  if (campaign.endsAt && campaign.endsAt < period.drawAt) return null;
  if (campaign.startsAt && campaign.startsAt > period.drawAt) return null;

  const held = {
    campaignId: campaign.id,
    periodKey: period.key,
    status: { in: ["RESERVED", "DRAWN", "SENT"] as DailyPrizeStatus[] },
  };
  const existing = await db.dailyPrize.findFirst({ where: held });
  if (existing) return existing;

  let pick: Candidate | null = null;
  let bundle: PrizeItem[] | null = null;
  let queued: string | null = null;
  if (!opts.productId && !opts.exclude) {
    // The merchant's queue first: the item pinned to this day, else the next in stock.
    for (const item of await queueFor(campaign.id, period)) {
      const parts = item.bundle as BundlePart[] | null;
      if (parts?.length) {
        const found = await bundleFor(admin, cfg, parts);
        if ("items" in found) {
          bundle = found.items;
          queued = item.id;
          break;
        }
        await db.dailyQueueItem.update({
          where: { id: item.id },
          data: {
            note: `Not enough stock of ${found.short} on ${period.key}, skipped`,
          },
        });
        continue;
      }
      const variants = await fetchCandidates(admin, cfg, {
        productId: item.productId,
        safetyStock: true,
      });
      pick = variants.sort(byStock)[0] ?? null;
      if (pick) {
        queued = item.id;
        break;
      }
      await db.dailyQueueItem.update({
        where: { id: item.id },
        data: { note: `Out of stock on ${period.key}, skipped` },
      });
    }
  }
  if (bundle) {
    // From the queue, as a bundle.
  } else if (pick) {
    // From the queue.
  } else if (opts.productId) {
    // Chosen by the merchant: any in-stock variant of that product, ignoring the price range
    // and product types, from safety stock too. The variant with the most stock is reserved.
    const variants = await fetchCandidates(admin, cfg, {
      productId: opts.productId,
      safetyStock: true,
    });
    pick = variants.sort(byStock)[0] ?? null;
    if (!pick)
      throw new Error(
        "That product has no inventory-tracked variant in stock or in safety stock to reserve.",
      );
  } else {
    const recent = await recentProducts(campaign.id, cfg.noRepeatDays);
    if (opts.exclude) recent.add(opts.exclude);
    const candidates = (
      await fetchCandidates(admin, cfg, { safetyStock: cfg.useSafetyStock })
    ).filter((c) => c.productId !== opts.exclude);
    pick = pickPrize(
      candidates,
      cfg,
      recent,
      () => randomInt(2 ** 31) / 2 ** 31,
    );
  }
  if (!pick && !bundle) {
    console.warn(
      `[daily] ${campaign.shop} ${campaign.slug}: no in-stock product matches the daily rules`,
    );
    return null;
  }

  // Picking takes a few seconds of Shopify calls, and the scheduler, the admin buttons and an
  // overlapping deploy can all pick at once. Re-check and create under a per-day lock so only
  // one prize is ever held (and reserved) for a day.
  const prize = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`daily-prize:${campaign.id}:${period.key}`}))`;
    if (await tx.dailyPrize.findFirst({ where: held })) return null;
    const first = bundle?.[0];
    return tx.dailyPrize.create({
      data: {
        campaignId: campaign.id,
        periodKey: period.key,
        opensAt: period.opensAt,
        drawAt: period.drawAt,
        ...(bundle && first
          ? {
              productId: first.productId,
              variantId: first.variantId,
              productHandle: first.productHandle,
              title: bundleTitle(bundle),
              imageUrl: first.imageUrl,
              value: bundleValue(bundle),
              inventoryItemId: first.inventoryItemId,
              locationId: first.locationId,
              reservedFrom: first.reservedFrom,
              items: bundle as unknown as object,
            }
          : {
              productId: pick!.productId,
              variantId: pick!.variantId,
              productHandle: pick!.productHandle,
              title: pick!.title,
              imageUrl: pick!.imageUrl,
              value: pick!.value,
              inventoryItemId: pick!.inventoryItemId,
              locationId: pick!.locationId,
              reservedFrom: pick!.source,
            }),
      },
    });
  });
  if (!prize) {
    // Someone else picked this day's prize while we were looking.
    if (opts.productId || opts.exclude)
      throw new Error("Today's prize just changed. Refresh and try again.");
    return db.dailyPrize.findFirst({ where: held });
  }
  try {
    await moveOne(admin, prize, "reserve");
  } catch (err) {
    // Not held, so it can't be the prize; the next tick tries another pick.
    await db.dailyPrize.update({
      where: { id: prize.id },
      data: {
        status: "RELEASED",
        note: `Couldn't reserve: ${(err as Error).message}`,
      },
    });
    throw err;
  }
  if (queued)
    await db.dailyQueueItem.update({
      where: { id: queued },
      data: { usedAt: new Date(), prizeId: prize.id, note: null },
    });
  return prize;
}

/** Makes a product the merchant chose today's prize, releasing any automatic pick. */
export async function choosePrize(
  campaign: Campaign,
  admin: Admin,
  productId: string,
) {
  const current = await currentPrize(campaign);
  const prize = current?.prize;
  if (prize && prize.status !== "RESERVED")
    throw new Error("Today's prize has already been drawn.");
  if (prize?.productId === productId) return prize;
  if (prize)
    await releasePrize(prize.id, admin, "Replaced by a chosen product");
  const next = await ensurePrize(campaign, admin, { productId });
  if (!next)
    throw new Error(
      "Couldn't set today's prize. Check that daily draw is on and the giveaway is live.",
    );
  return next;
}

/** Releases the current prize back to stock and picks a different one. */
export async function swapPrize(campaign: Campaign, admin: Admin) {
  const current = await currentPrize(campaign);
  const prize = current?.prize;
  if (prize && prize.status !== "RESERVED")
    throw new Error("Today's prize has already been drawn.");
  if (prize) await releasePrize(prize.id, admin, "Swapped for another prize");
  const next = await ensurePrize(campaign, admin, {
    exclude: prize?.productId,
  });
  if (!next)
    throw new Error("No other in-stock product matches the daily rules.");
  return next;
}

/** Puts a held prize back into normal stock. */
export async function releasePrize(
  prizeId: string,
  admin: Admin,
  note: string,
) {
  const prize = await db.dailyPrize.findUnique({ where: { id: prizeId } });
  if (!prize || prize.status === "RELEASED" || prize.status === "SENT") return;
  await moveOne(admin, prize, "release");
  await db.dailyPrize.update({
    where: { id: prize.id },
    data: { status: "RELEASED", note },
  });
}

/** The winner has their prize: take the reserved unit out of inventory. */
export async function markPrizeSent(prizeId: string, admin: Admin) {
  const prize = await db.dailyPrize.findUnique({ where: { id: prizeId } });
  if (!prize || prize.status !== "DRAWN")
    throw new Error("Only a drawn prize can be marked sent.");
  await removeOne(admin, prize);
  await db.dailyPrize.update({
    where: { id: prize.id },
    data: { status: "SENT" },
  });
}

// ── Draw ────────────────────────────────────────────────────────────────────

/** Entries earned during the prize's day, per active entrant. */
export async function dayTickets(
  prize: Pick<DailyPrize, "campaignId" | "opensAt" | "drawAt">,
) {
  const rows = await db.entryEvent.groupBy({
    by: ["entrantId"],
    where: {
      campaignId: prize.campaignId,
      createdAt: { gte: prize.opensAt, lt: prize.drawAt },
      entrant: { status: "ACTIVE" },
    },
    _sum: { entries: true },
  });
  return onlyFullyEntered(
    prize.campaignId,
    rows
      .map((r) => ({
        entrantId: r.entrantId,
        entries: Math.max(0, r._sum.entries ?? 0),
      }))
      .filter((t) => t.entries > 0),
  );
}

/** Entries an entrant has earned in the current daily period. */
export async function entrantDayEntries(entrantId: string, opensAt: Date) {
  const { _sum } = await db.entryEvent.aggregate({
    where: { entrantId, createdAt: { gte: opensAt } },
    _sum: { entries: true },
  });
  return Math.max(0, _sum.entries ?? 0);
}

/**
 * Draws one held prize whose draw time has passed. The status update claims the
 * prize, so a second run can't draw it twice. Returns the draw, or null when nobody
 * entered that day (the prize then goes back to stock).
 */
export async function drawPrize(prize: DailyPrize, admin: Admin) {
  const claimed = await db.dailyPrize.updateMany({
    where: { id: prize.id, status: "RESERVED" },
    data: { status: "DRAWN" },
  });
  if (claimed.count === 0) return null;

  try {
    const campaign = await db.campaign.findUniqueOrThrow({
      where: { id: prize.campaignId },
    });
    const cfg = dailySettings(campaign);
    const recentWinners = await db.winner.findMany({
      where: {
        forfeited: false,
        draw: {
          campaignId: campaign.id,
          createdAt: {
            gte: new Date(Date.now() - cfg.winCooldownDays * DAY_MS),
          },
        },
      },
      select: { entrantId: true },
    });
    const excluded = new Set(recentWinners.map((w) => w.entrantId));
    const pool = (await dayTickets(prize)).filter(
      (t) => !excluded.has(t.entrantId),
    );

    if (!pool.length) {
      await db.dailyPrize.update({
        where: { id: prize.id },
        data: { status: "RESERVED" },
      });
      await releasePrize(prize.id, admin, "Nobody entered that day");
      return null;
    }

    const seed = newSeed();
    const [winnerId] = drawWinners(pool, 1, seed);
    const draw = await db.draw.create({
      data: {
        campaignId: campaign.id,
        seed,
        snapshotHash: snapshotHash(pool),
        totalEntries: pool.reduce((s, t) => s + t.entries, 0),
        eligibleCount: pool.length,
        createdBy: "daily draw",
        winners: { create: [{ entrantId: winnerId, position: 1 }] },
      },
    });
    await db.dailyPrize.update({
      where: { id: prize.id },
      data: { drawId: draw.id },
    });
    emitWebhook(campaign.id, "draw.completed", {
      drawId: draw.id,
      dailyPrize: prize.title,
    });
    if (parseSettings(campaign.settings).winnerEmail.enabled) {
      try {
        await emailDrawWinners(
          draw.id,
          await storefrontUrl(admin, campaign.shop),
        );
      } catch (err) {
        console.error(`[daily] winner email failed: ${(err as Error).message}`);
      }
    }
    return draw;
  } catch (err) {
    // Hand the prize back to the next tick unless a draw was recorded.
    const fresh = await db.dailyPrize.findUnique({ where: { id: prize.id } });
    if (fresh && !fresh.drawId && fresh.status === "DRAWN") {
      await db.dailyPrize.update({
        where: { id: prize.id },
        data: { status: "RESERVED" },
      });
    }
    throw err;
  }
}

/**
 * Replaces a forfeited daily winner from that day's entries. The new winner joins the same
 * draw, so the winner email, claim page and $0 prize order all still name that day's
 * product. Skips everyone already in this draw and recent winners (the nightly cooldown).
 */
export async function redrawDailyWinner(
  prize: Pick<DailyPrize, "campaignId" | "opensAt" | "drawAt"> & {
    drawId: string;
  },
) {
  const campaign = await db.campaign.findUniqueOrThrow({
    where: { id: prize.campaignId },
  });
  const cfg = dailySettings(campaign);
  const [inDraw, recentWinners] = await Promise.all([
    db.winner.findMany({
      where: { drawId: prize.drawId },
      select: { entrantId: true },
    }),
    db.winner.findMany({
      where: {
        forfeited: false,
        draw: {
          campaignId: campaign.id,
          createdAt: {
            gte: new Date(Date.now() - cfg.winCooldownDays * DAY_MS),
          },
        },
      },
      select: { entrantId: true },
    }),
  ]);
  const excluded = new Set(
    [...inDraw, ...recentWinners].map((w) => w.entrantId),
  );
  const pool = (await dayTickets(prize)).filter(
    (t) => !excluded.has(t.entrantId),
  );
  if (!pool.length) throw new Error("Nobody else entered that day.");

  const [entrantId] = drawWinners(pool, 1, newSeed());
  return db.winner.create({
    data: { drawId: prize.drawId, entrantId, position: inDraw.length + 1 },
  });
}

// ── Scheduler ───────────────────────────────────────────────────────────────

const adminFor = async (shop: string) =>
  (await unauthenticated.admin(shop)).admin;

/** Draws every prize that's due, then makes sure each live daily giveaway has today's prize. */
export async function runDailyJobs(now = new Date()) {
  const result = { drawn: 0, empty: 0, picked: 0, errors: [] as string[] };

  const due = await db.dailyPrize.findMany({
    where: { campaign:{shop:"hhuuev-81.myshopify.com"}, status: "RESERVED", drawAt: { lte: now } },
    include: { campaign: { select: { shop: true } } },
  });
  for (const prize of due) {
    try {
      const draw = await drawPrize(prize, await adminFor(prize.campaign.shop));
      if (draw) result.drawn++;
      else result.empty++;
    } catch (err) {
      result.errors.push(`draw ${prize.id}: ${(err as Error).message}`);
    }
  }

  const live = await db.campaign.findMany({
    where: { shop: "hhuuev-81.myshopify.com",
      status: "ACTIVE",
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
  });
  for (const campaign of live) {
    if (!dailySettings(campaign).enabled) continue;
    try {
      const before = await currentPrize(campaign, now);
      if (before?.prize) continue;
      if (await ensurePrize(campaign, await adminFor(campaign.shop), { now }))
        result.picked++;
    } catch (err) {
      result.errors.push(`pick ${campaign.slug}: ${(err as Error).message}`);
    }
  }
  if (result.errors.length) console.error("[daily]", result.errors.join(" | "));
  return result;
}

let running = false;
/** Runs the daily jobs unless a run is already in progress in this process. */
export async function tickDaily() {
  if (running) return null;
  running = true;
  try {
    return await runDailyJobs();
  } finally {
    running = false;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __pcgDailyTimer: ReturnType<typeof setInterval> | undefined;
}

/** Starts the once-a-minute scheduler (once per process). */
export function startDailyScheduler() {
  if (globalThis.__pcgDailyTimer || process.env.NODE_ENV === "test") return;
  if (process.env.DAILY_SCHEDULER === "off") return;
  const run = () =>
    tickDaily().catch((err) =>
      console.error(`[daily] tick failed: ${(err as Error).message}`),
    );
  globalThis.__pcgDailyTimer = setInterval(run, 60_000);
  setTimeout(run, 15_000);
}

// ── Storefront ──────────────────────────────────────────────────────────────

/** What the widget shows for a daily giveaway: today's prize, the draw time, the last winner. */
export async function storefrontDaily(
  campaign: Campaign,
  entrantId?: string | null,
) {
  const current = await currentPrize(campaign);
  if (!current) return null;
  const { period, prize } = current;
  const last = await db.dailyPrize.findFirst({
    where: { campaignId: campaign.id, drawId: { not: null } },
    orderBy: { drawAt: "desc" },
    include: {
      draw: {
        include: {
          winners: {
            where: { forfeited: false },
            take: 1,
            include: { entrant: { select: { name: true, email: true } } },
          },
        },
      },
    },
  });
  const lastWinner = last?.draw?.winners[0];
  // What's lined up for the next few days (only the merchant's queue is known ahead).
  const upcoming = (await upcomingPlan(campaign, 4)).plan.flatMap((d) =>
    d.item
      ? [
          {
            date: d.date,
            title: d.item.title,
            imageUrl: d.item.imageUrl,
            items: Array.isArray(d.item.bundle)
              ? publicItems(d.item.bundle as unknown as BundlePart[])
              : null,
          },
        ]
      : [],
  );
  return {
    drawAt: period.drawAt.toISOString(),
    // Store-timezone date of the next draw, so the widget can label it "Tomorrow".
    tomorrow: addDays(period.key, 1),
    upcoming,
    prize: prize
      ? {
          title: prize.title,
          imageUrl: prize.imageUrl,
          value: prize.value,
          url: prize.productHandle ? `/products/${prize.productHandle}` : null,
          // Bundles: each product with its "3x" count (null for a single product).
          items: (() => {
            const items = prizeItems(prize.items);
            return items ? publicItems(items) : null;
          })(),
        }
      : null,
    yourEntries: entrantId
      ? await entrantDayEntries(entrantId, period.opensAt)
      : null,
    // Whether the entrant has entered today's draw (signing up only counts on the day).
    enteredToday: entrantId
      ? await enteredToday(entrantId, period.opensAt)
      : null,
    lastWinner:
      last && lastWinner && parseSettings(campaign.settings).showWinners
        ? {
            name: publicName(lastWinner.entrant.name, lastWinner.entrant.email),
            prize: last.title,
            drawnAt: last.drawAt.toISOString(),
          }
        : null,
  };
}

/**
 * The entrant's own part of `storefrontDaily` (entries today, entered today), so the shared
 * part can be cached for everyone. Null when the daily draw is off.
 */
export async function storefrontDailyEntrant(
  campaign: Campaign,
  entrantId: string,
  now = new Date(),
) {
  const cfg = dailySettings(campaign);
  if (!cfg.enabled) return null;
  const period = periodFor(now, campaign.timezone, cfg.drawTime);
  return {
    yourEntries: await entrantDayEntries(entrantId, period.opensAt),
    enteredToday: await enteredToday(entrantId, period.opensAt),
  };
}

// ── History ─────────────────────────────────────────────────────────────────

/**
 * Each daily draw, newest first: its prize, the people and entries in it (only that day's
 * entries count, so the live day shows its total so far) and the winner.
 */
export async function drawHistory(campaign: Campaign, limit = 30) {
  const prizes = await db.dailyPrize.findMany({
    where: {
      campaignId: campaign.id,
      OR: [{ status: { not: "RELEASED" } }, { drawId: { not: null } }],
    },
    orderBy: [{ drawAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    include: {
      draw: {
        include: {
          winners: {
            where: { forfeited: false },
            take: 1,
            include: { entrant: { select: { name: true, email: true } } },
          },
        },
      },
    },
  });
  const seen = new Set<string>();
  const rows = [];
  for (const p of prizes) {
    if (seen.has(p.periodKey)) continue;
    seen.add(p.periodKey);
    const tickets = await dayTickets(p);
    const w = p.draw?.winners[0];
    rows.push({
      key: p.periodKey,
      title: p.title,
      status: p.status,
      drawAt: p.drawAt.toISOString(),
      entrants: tickets.length,
      entries: tickets.reduce((s, t) => s + t.entries, 0),
      winner: w ? publicName(w.entrant.name, w.entrant.email) : null,
    });
  }
  return rows;
}

export type DrawHistoryRow = Awaited<ReturnType<typeof drawHistory>>[number];
