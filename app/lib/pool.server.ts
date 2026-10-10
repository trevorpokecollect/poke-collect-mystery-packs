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
  packOrder: { openToken: string; held: boolean } | null;
}

/**
 * Claims the next slot in each series' committed sequence for every pack on the order.
 * Idempotent: webhook retries only draw packs that have not been drawn yet.
 */
export async function drawForOrder(db: PrismaClient, input: DrawInput): Promise<DrawResult> {
  const variantIds = [...new Set(input.lines.map((l) => l.variantId))];
  const seriesList = await db.series.findMany({
    where: { shop: input.shop, packVariantId: { in: variantIds } },
  });
  const byVariant = new Map(seriesList.map((s) => [s.packVariantId, s]));
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
      },
      update: input.checkoutToken ? { checkoutToken: input.checkoutToken } : {},
    });

    const pulls: Pull[] = [];
    const shortfall: DrawResult["shortfall"] = [];

    for (const line of lines) {
      const series = byVariant.get(line.variantId)!;
      const existing = await tx.pull.findMany({ where: { lineItemId: line.lineItemId } });
      const drawn = new Set(existing.map((p) => p.packIndex));
      let missing = 0;

      for (let packIndex = 0; packIndex < line.quantity; packIndex++) {
        if (drawn.has(packIndex)) continue;
        const slot =
          series.status === "LIVE"
            ? await tx.slot.findFirst({
                where: { seriesId: series.id, claimed: false, voided: false },
                orderBy: { position: "asc" },
              })
            : null;
        if (!slot) {
          missing++;
          continue;
        }
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
              customerId: input.customerId,
            },
          }),
        );
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
  const remaining = await tx.slot.count({
    where: { seriesId, claimed: false, voided: false },
  });
  if (remaining === 0) {
    await tx.series.updateMany({
      where: { id: seriesId, status: "LIVE" },
      data: { status: "CLOSED", closedAt: new Date() },
    });
  }
}

/** Who is asking to see or open packs: a logged-in customer or an order link token. */
export type Viewer = { customerId: string } | { openToken: string };

async function orderIdsForViewer(db: Db, viewer: Viewer): Promise<string[] | null> {
  if ("openToken" in viewer) {
    const order = await db.packOrder.findUnique({ where: { openToken: viewer.openToken } });
    return order ? [order.orderId] : [];
  }
  return null;
}

const pullInclude = {
  slot: { include: { card: true } },
  series: { select: { title: true, handle: true, packProductId: true } },
} as const;

export async function pullsForViewer(db: Db, shop: string, viewer: Viewer) {
  const orderIds = await orderIdsForViewer(db, viewer);
  const where: Prisma.PullWhereInput = {
    shop,
    status: { not: "VOIDED" },
    ...(orderIds ? { orderId: { in: orderIds } } : { customerId: (viewer as { customerId: string }).customerId }),
  };
  return db.pull.findMany({ where, include: pullInclude, orderBy: { createdAt: "desc" } });
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

    const orderIds = await orderIdsForViewer(tx, viewer);
    const allowed = orderIds
      ? orderIds.includes(pull.orderId)
      : pull.customerId === (viewer as { customerId: string }).customerId;
    if (!allowed) throw new PoolError("Pack not found.");

    if (pull.status === "UNOPENED") {
      await tx.pull.update({
        where: { id: pull.id },
        data: { status: "REVEALED", revealedAt: new Date() },
      });
    }
    const unopened = await tx.pull.count({
      where: { orderId: pull.orderId, status: "UNOPENED" },
    });
    return { pull, card: pull.slot.card, orderId: pull.orderId, orderReady: unopened === 0 };
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
      where: { orderId, status: { in: ["UNOPENED", "REVEALED"] } },
      orderBy: [{ lineItemId: "asc" }, { packIndex: "desc" }],
    });
    const toVoid: Pull[] = [];
    const counts = new Map<string, number>();
    for (const pull of pulls) {
      if (limitPerLine) {
        const limit = limitPerLine.get(pull.lineItemId) ?? 0;
        const used = counts.get(pull.lineItemId) ?? 0;
        if (used >= limit) continue;
        counts.set(pull.lineItemId, used + 1);
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
    totalPacks: total,
    packsRemaining: totalRemaining,
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
