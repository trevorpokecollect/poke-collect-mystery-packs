// Database-only pack logic: launching a series, drawing at payment, revealing,
// voiding. Nothing here talks to Shopify, so it can be tested against Postgres alone.
import { Prisma, type PrismaClient, type Pull } from "@prisma/client";
import { commitmentHash, newSalt, newToken, secureShuffle } from "./fairness.server";

type Db = PrismaClient | Prisma.TransactionClient;

export class PoolError extends Error {}

/** Creates one slot per physical card, shuffles them and commits to the order. */
export async function launchSeries(db: PrismaClient, seriesId: string) {
  return db.$transaction(async (tx) => {
    const series = await tx.series.findUniqueOrThrow({
      where: { id: seriesId },
      include: { cards: true },
    });
    if (series.status !== "DRAFT") {
      throw new PoolError("Only a draft series can be launched.");
    }
    const copies = series.cards.flatMap((card) =>
      Array.from({ length: card.quantity }, () => card),
    );
    if (copies.length === 0) {
      throw new PoolError("Add at least one card before launching.");
    }

    const order = secureShuffle(copies);
    const salt = newSalt();
    const commitHash = commitmentHash(
      salt,
      order.map((card) => card.variantId),
    );

    await tx.slot.deleteMany({ where: { seriesId } });
    await tx.slot.createMany({
      data: order.map((card, position) => ({
        seriesId,
        cardId: card.id,
        position,
      })),
    });

    return tx.series.update({
      where: { id: seriesId },
      data: { status: "LIVE", salt, commitHash, launchedAt: new Date() },
    });
  });
}

export interface PackLine {
  lineItemId: string;
  variantId: string;
  quantity: number;
}

export interface DrawInput {
  shop: string;
  orderId: string;
  orderName: string;
  customerId: string | null;
  checkoutToken?: string | null;
  lines: PackLine[];
}

export interface DrawResult {
  pulls: Pull[];
  /** Packs that could not be drawn because the series had no cards left. */
  shortfall: { lineItemId: string; missing: number }[];
  packOrder: { openToken: string; held: boolean; vault: boolean } | null;
}

/**
 * Claims the next slot in each series' committed sequence for every pack on the order.
 * Idempotent: webhook retries only draw packs that have not been drawn yet.
 */
export async function drawForOrder(db: PrismaClient, input: DrawInput): Promise<DrawResult> {
  const variantIds = [...new Set(input.lines.map((l) => l.variantId))];
  // A pack product can be reused by later series, so draw from the live one. A series that
  // already drew for this order (e.g. a retried webhook after it sold out) still counts.
  const candidates = await db.series.findMany({
    where: {
      shop: input.shop,
      packVariantId: { in: variantIds },
      OR: [{ status: "LIVE" }, { pulls: { some: { orderId: input.orderId } } }],
    },
    include: { _count: { select: { pulls: { where: { orderId: input.orderId } } } } },
    orderBy: { createdAt: "asc" },
  });
  const byVariant = new Map<string, (typeof candidates)[number]>();
  for (const s of candidates) {
    const current = byVariant.get(s.packVariantId);
    if (!current || (current._count.pulls === 0 && (s._count.pulls > 0 || s.status === "LIVE"))) {
      byVariant.set(s.packVariantId, s);
    }
  }
  const seriesList = [...byVariant.values()];
  const lines = input.lines.filter((l) => byVariant.has(l.variantId));
  if (lines.length === 0) return { pulls: [], shortfall: [], packOrder: null };

  return db.$transaction(async (tx) => {
    // Serialize draws per series so two orders can never claim the same position.
    const ids = seriesList.map((s) => s.id).sort();
    await tx.$queryRaw`SELECT id FROM "Series" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;

    const packOrder = await tx.packOrder.upsert({
      where: { orderId: input.orderId },
      create: {
        orderId: input.orderId,
        shop: input.shop,
        orderName: input.orderName,
        customerId: input.customerId,
        checkoutToken: input.checkoutToken ?? null,
        openToken: newToken(),
        // New orders keep their pulls in the customer's vault until they ask to ship them.
        vault: true,
      },
      update: input.checkoutToken ? { checkoutToken: input.checkoutToken } : {},
    });

    const pulls: Pull[] = [];
    const shortfall: DrawResult["shortfall"] = [];

    for (const line of lines) {
      const series = byVariant.get(line.variantId)!;
      const existing = await tx.pull.findMany({ where: { lineItemId: line.lineItemId } });
      const drawn = new Set(existing.map((p) => p.packIndex));
      const perPack = Math.max(1, series.cardsPerPack);
      let missing = 0;

      for (let packIndex = 0; packIndex < line.quantity; packIndex++) {
        if (drawn.has(packIndex)) continue;
        // A pack takes the next `perPack` cards in the committed order, or none if that many aren't left.
        const slots =
          series.status === "LIVE"
            ? await tx.slot.findMany({
                where: { seriesId: series.id, claimed: false, voided: false },
                orderBy: { position: "asc" },
                take: perPack,
              })
            : [];
        if (slots.length < perPack) {
          missing++;
          continue;
        }
        for (const [cardIndex, slot] of slots.entries()) {
          await tx.slot.update({ where: { id: slot.id }, data: { claimed: true } });
          pulls.push(
            await tx.pull.create({
              data: {
                shop: input.shop,
                seriesId: series.id,
                slotId: slot.id,
                orderId: input.orderId,
                orderName: input.orderName,
                lineItemId: line.lineItemId,
                packIndex,
                cardIndex,
                customerId: input.customerId,
              },
            }),
          );
        }
      }
      if (missing > 0) shortfall.push({ lineItemId: line.lineItemId, missing });
    }

    for (const series of seriesList) {
      await closeIfEmpty(tx, series.id);
    }

    return { pulls, shortfall, packOrder };
  });
}

async function closeIfEmpty(tx: Db, seriesId: string) {
  const series = await tx.series.findUnique({ where: { id: seriesId }, select: { cardsPerPack: true } });
  const remaining = await tx.slot.count({
    where: { seriesId, claimed: false, voided: false },
  });
  // Sold out once there aren't enough cards left for one more full pack.
  if (remaining < Math.max(1, series?.cardsPerPack ?? 1)) {
    await tx.series.updateMany({
      where: { id: seriesId, status: "LIVE" },
      data: { status: "CLOSED", closedAt: new Date() },
    });
  }
}

/**
 * Who is asking to see or open packs: a logged-in customer, an order link token, or both
 * (a logged-in customer following an order link sees their whole history plus that order).
 */
export type Viewer = { customerId?: string; openToken?: string };

/** Pulls this viewer may see: their own (when logged in) and the order the link belongs to. */
async function viewerScope(db: Db, viewer: Viewer): Promise<Prisma.PullWhereInput[]> {
  const scope: Prisma.PullWhereInput[] = [];
  if (viewer.customerId) scope.push({ customerId: viewer.customerId });
  if (viewer.openToken) {
    const order = await db.packOrder.findUnique({ where: { openToken: viewer.openToken } });
    if (order) scope.push({ orderId: order.orderId });
  }
  return scope;
}

/**
 * A logged-in customer holding a guest order's link (e.g. after logging in from the opener)
 * takes ownership of that order's packs, so they show in their vault from then on.
 * Only packs with no customer yet are claimed; packs already tied to an account stay put.
 */
export async function claimGuestOrder(db: Db, viewer: Viewer) {
  if (!viewer.customerId || !viewer.openToken) return 0;
  const order = await db.packOrder.findUnique({ where: { openToken: viewer.openToken } });
  if (!order || order.customerId) return 0;
  await db.packOrder.update({ where: { orderId: order.orderId }, data: { customerId: viewer.customerId } });
  const pulls = await db.pull.updateMany({ where: { orderId: order.orderId, customerId: null }, data: { customerId: viewer.customerId } });
  return pulls.count;
}

/**
 * Pack orders that came in without a customer (the webhook arrived before Shopify linked the
 * checkout to an account): looks the customer up on the order and attaches it to the packs.
 */
export async function attachMissingCustomers(db: Db, adminFor: (shop: string) => Promise<{ graphql: (q: string, o?: { variables: Record<string, unknown> }) => Promise<Response> }>) {
  const orders = await db.packOrder.findMany({
    where: { customerId: null, createdAt: { gt: new Date(Date.now() - 60 * 86_400_000) } },
    select: { orderId: true, shop: true },
    take: 100,
  });
  let attached = 0;
  for (const shop of new Set(orders.map((o) => o.shop))) {
    const ids = orders.filter((o) => o.shop === shop).map((o) => o.orderId);
    try {
      const admin = await adminFor(shop);
      const response = await admin.graphql(
        `#graphql
          query PackOrderCustomers($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { id customer { id } } } }`,
        { variables: { ids } },
      );
      const json = (await response.json()) as { data?: { nodes: ({ id: string; customer: { id: string } | null } | null)[] } };
      for (const node of json.data?.nodes ?? []) {
        if (!node?.customer) continue;
        await db.packOrder.update({ where: { orderId: node.id }, data: { customerId: node.customer.id } });
        await db.pull.updateMany({ where: { orderId: node.id, customerId: null }, data: { customerId: node.customer.id } });
        attached++;
      }
    } catch (error) {
      console.error(`Attaching customers for ${shop} failed`, error);
    }
  }
  return attached;
}

const pullInclude = {
  slot: { include: { card: true } },
  series: { select: { title: true, handle: true, packProductId: true, cardsPerPack: true } },
  shipRequest: { select: { id: true, status: true, invoiceUrl: true, expiresAt: true } },
} as const;

export async function pullsForViewer(db: Db, shop: string, viewer: Viewer) {
  await claimGuestOrder(db, viewer);
  const scope = await viewerScope(db, viewer);
  if (scope.length === 0) return [];
  return db.pull.findMany({
    where: { shop, status: { not: "VOIDED" }, OR: scope },
    include: pullInclude,
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Reveals one pack. Returns the card and whether every pack on that order is now
 * revealed (meaning the order can be finalized and shipped).
 */
export async function revealPull(db: PrismaClient, shop: string, pullId: string, viewer: Viewer) {
  return db.$transaction(async (tx) => {
    const pull = await tx.pull.findFirst({
      where: { id: pullId, shop },
      include: pullInclude,
    });
    if (!pull || pull.status === "VOIDED") throw new PoolError("Pack not found.");

    const scope = await viewerScope(tx, viewer);
    const allowed = scope.some((s) =>
      s.orderId ? s.orderId === pull.orderId : !!s.customerId && s.customerId === pull.customerId,
    );
    if (!allowed) throw new PoolError("Pack not found.");

    // A multi-card pack opens all its cards at once (they share the line item and pack index).
    const pack = await tx.pull.findMany({
      where: { lineItemId: pull.lineItemId, packIndex: pull.packIndex, status: { not: "VOIDED" } },
      include: pullInclude,
      orderBy: { cardIndex: "asc" },
    });
    await tx.pull.updateMany({
      where: { id: { in: pack.map((p) => p.id) }, status: "UNOPENED" },
      data: { status: "REVEALED", revealedAt: new Date() },
    });
    const unopened = await tx.pull.count({
      where: { orderId: pull.orderId, status: "UNOPENED" },
    });
    // Reveal order: lowest value first, best card last.
    const cards = pack
      .map((p) => p.slot.card)
      .sort((a, b) => Number(a.marketValue) - Number(b.marketValue));
    return { pull, card: cards[cards.length - 1] ?? pull.slot.card, cards, orderId: pull.orderId, orderReady: unopened === 0 };
  });
}

/** Reveals packs left unopened past their series' auto-open window. Returns orders now ready. */
export async function autoOpenDue(db: PrismaClient, now = new Date()) {
  const candidates = await db.pull.findMany({
    where: { status: "UNOPENED" },
    include: { series: { select: { autoOpenDays: true } } },
  });
  // An order's packs open together once its oldest pack is past the window.
  const dueOrders = new Set(
    candidates
      .filter((p) => now.getTime() - p.createdAt.getTime() >= p.series.autoOpenDays * 86_400_000)
      .map((p) => p.orderId),
  );
  const due = candidates.filter((p) => dueOrders.has(p.orderId));
  if (due.length === 0) return [];

  await db.pull.updateMany({
    where: { id: { in: due.map((p) => p.id) }, status: "UNOPENED" },
    data: { status: "REVEALED", revealedAt: now, autoOpened: true },
  });
  return ordersReadyToFinalize(db, [...new Set(due.map((p) => p.orderId))]);
}

/** Orders with drawn packs, none unopened, not yet finalized. */
export async function ordersReadyToFinalize(db: Db, orderIds?: string[]) {
  const orders = await db.packOrder.findMany({
    where: { finalized: false, ...(orderIds ? { orderId: { in: orderIds } } : {}) },
  });
  const ready: { orderId: string; shop: string }[] = [];
  for (const order of orders) {
    const [unopened, revealed] = await Promise.all([
      db.pull.count({ where: { orderId: order.orderId, status: "UNOPENED" } }),
      db.pull.count({ where: { orderId: order.orderId, status: "REVEALED" } }),
    ]);
    if (unopened === 0 && revealed > 0) ready.push({ orderId: order.orderId, shop: order.shop });
  }
  return ready;
}

/**
 * Voids packs on a refunded/cancelled order that have not been sent to fulfillment.
 * Their slots are voided (not resold) so the published sequence stays intact;
 * the physical card simply stays in stock.
 */
export async function voidPulls(
  db: PrismaClient,
  orderId: string,
  limitPerLine?: Map<string, number>,
) {
  return db.$transaction(async (tx) => {
    const pulls = await tx.pull.findMany({
      // Cards already on a ship request are left alone; that request settles them.
      where: { orderId, status: { in: ["UNOPENED", "REVEALED"] }, shipRequestId: null },
      orderBy: [{ lineItemId: "asc" }, { packIndex: "desc" }],
    });
    // Limits count packs, not cards: every card of a voided pack goes together.
    const toVoid: Pull[] = [];
    const packsPicked = new Map<string, Set<number>>();
    for (const pull of pulls) {
      if (limitPerLine) {
        const limit = limitPerLine.get(pull.lineItemId) ?? 0;
        const picked = packsPicked.get(pull.lineItemId) ?? new Set<number>();
        if (!picked.has(pull.packIndex)) {
          if (picked.size >= limit) continue;
          picked.add(pull.packIndex);
          packsPicked.set(pull.lineItemId, picked);
        }
      }
      toVoid.push(pull);
    }
    if (toVoid.length === 0) return [];
    await tx.pull.updateMany({
      where: { id: { in: toVoid.map((p) => p.id) } },
      data: { status: "VOIDED" },
    });
    await tx.slot.updateMany({
      where: { id: { in: toVoid.map((p) => p.slotId) } },
      data: { voided: true },
    });
    for (const seriesId of new Set(toVoid.map((p) => p.seriesId))) {
      await closeIfEmpty(tx, seriesId);
    }
    return toVoid;
  });
}

/** The launched series sold through a pack product (the newest one if a product was reused). */
export async function seriesHandleForProduct(db: Db, shop: string, productId: string) {
  const series = await db.series.findFirst({
    where: { shop, packProductId: productId, status: { not: "DRAFT" } },
    orderBy: { createdAt: "desc" },
    select: { handle: true },
  });
  return series?.handle ?? null;
}

/** Tier names from highest to lowest, using the series' tier rules when it has them. */
function tierOrder(tierRules: unknown): string[] {
  if (!Array.isArray(tierRules)) return [];
  return [...tierRules]
    .filter((r): r is { name: string; min: number } => typeof r?.name === "string" && typeof r?.min === "number")
    .sort((a, b) => b.min - a.min)
    .map((r) => r.name);
}

/** Public odds: every card with its total and remaining copies. Card values stay admin-only. */
export async function seriesOdds(db: Db, shop: string, handle: string) {
  const series = await db.series.findUnique({
    where: { shop_handle: { shop, handle } },
    include: { cards: { orderBy: [{ sortOrder: "asc" }, { marketValue: "desc" }] } },
  });
  if (!series || series.status === "DRAFT") return null;

  const remaining = await db.slot.groupBy({
    by: ["cardId"],
    where: { seriesId: series.id, claimed: false, voided: false },
    _count: { _all: true },
  });
  const remainingBy = new Map(remaining.map((r) => [r.cardId, r._count._all]));
  const totalRemaining = remaining.reduce((sum, r) => sum + r._count._all, 0);
  const total = series.cards.reduce((sum, c) => sum + c.quantity, 0);

  return {
    title: series.title,
    handle: series.handle,
    status: series.status,
    packPrice: series.packPrice.toString(),
    commitHash: series.commitHash,
    // The salt and full sequence are only published once the series is closed.
    reveal:
      series.status === "CLOSED"
        ? {
            salt: series.salt,
            sequence: (
              await db.slot.findMany({
                where: { seriesId: series.id },
                orderBy: { position: "asc" },
                select: { card: { select: { variantId: true } } },
              })
            ).map((s) => s.card.variantId),
          }
        : null,
    // Multi-card packs: packs = cards / cards per pack. Tier and card odds stay per card.
    cardsPerPack: series.cardsPerPack,
    totalPacks: Math.floor(total / Math.max(1, series.cardsPerPack)),
    packsRemaining: Math.floor(totalRemaining / Math.max(1, series.cardsPerPack)),
    // Odds of pulling each tier right now, highest tier first.
    tiers: (() => {
      const byTier = new Map<string, { remaining: number; total: number }>();
      for (const c of series.cards) {
        const entry = byTier.get(c.tier) ?? { remaining: 0, total: 0 };
        entry.remaining += remainingBy.get(c.id) ?? 0;
        entry.total += c.quantity;
        byTier.set(c.tier, entry);
      }
      const order = tierOrder(series.tierRules);
      const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
      return [...byTier.entries()]
        .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
        .map(([name, n]) => ({
          name,
          remaining: n.remaining,
          total: n.total,
          currentOdds: totalRemaining > 0 ? n.remaining / totalRemaining : 0,
        }));
    })(),
    cards: series.cards.map((c) => {
      const left = remainingBy.get(c.id) ?? 0;
      return {
        title: c.title,
        tier: c.tier,
        imageUrl: c.imageUrl,
        quantity: c.quantity,
        remaining: left,
        currentOdds: totalRemaining > 0 ? left / totalRemaining : 0,
      };
    }),
  };
}

/** Live series that still have packs to sell, with how many are left. */
export async function availableSeries(db: Db, shop: string) {
  const series = await db.series.findMany({
    where: { shop, status: "LIVE" },
    orderBy: { launchedAt: "desc" },
  });
  const left = await db.slot.groupBy({
    by: ["seriesId"],
    where: { seriesId: { in: series.map((s) => s.id) }, claimed: false, voided: false },
    _count: { _all: true },
  });
  const leftBy = new Map(left.map((r) => [r.seriesId, r._count._all]));
  return series
    .map((s) => ({ series: s, packsLeft: Math.floor((leftBy.get(s.id) ?? 0) / Math.max(1, s.cardsPerPack)) }))
    .filter((s) => s.packsLeft > 0);
}
