import { randomInt, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { featureOn } from "./cardbit-flags.server";
import { cardbitDay, levelProgress, previousDay, spinnerFor } from "./cardbit-levels";
import { awardXp } from "./cardbit-levels.server";
import { sparksEnabled } from "./cardbit-sparks.server";
import { drawForOrderInTransaction } from "./pool.server";
import {
  DEFAULT_SPIN_TABLE,
  pickSlice,
  totalWeight,
  validTable,
  weightedSlices,
  type Slice,
  type SpinTable,
} from "./cardbit-spinner";

type Tx = Prisma.TransactionClient;
export const SPIN_TABLE_KEY = "cardbit:spin-table";

/** Off until official rules, a free entry method and Trevor's approval exist (CARDBIT_SPINNER=on; "qa" = QA customers only). */
export const spinnerEnabled = (shop: string, customerId?: string | null, env: NodeJS.ProcessEnv = process.env) =>
  featureOn("CARDBIT_SPINNER", shop, customerId, env);

/** A Daily Spin pool is a series marked in its build rules; it is never sold as a pack. */
export const dailySpinRules = (tier: string) => ({ path: ["cardbitDailySpin"], equals: tier });

export class SpinError extends Error {}

export async function spinTable(db: PrismaClient | Tx): Promise<SpinTable> {
  const row = await db.appValue.findUnique({ where: { key: SPIN_TABLE_KEY } });
  try {
    const parsed = row ? JSON.parse(row.value) : null;
    if (validTable(parsed)) return { ...DEFAULT_SPIN_TABLE, ...parsed };
  } catch {
    /* fall back to defaults */
  }
  return DEFAULT_SPIN_TABLE;
}

async function drawSpinCard(tx: Tx, shop: string, customerId: string, tier: string, day: string) {
  const series = await tx.series.findFirst({
    where: { shop, status: "LIVE", staffTest: false, buildRules: dailySpinRules(tier) },
    orderBy: { createdAt: "asc" },
  });
  if (!series) return null;
  const orderId = "cardbit-spin:" + randomUUID();
  const draw = await drawForOrderInTransaction(
    tx,
    {
      shop,
      orderId,
      orderName: "Daily Spin " + day,
      customerId,
      lines: [{ lineItemId: orderId + "/1", quantity: 1, variantId: series.packVariantId }],
    },
    { id: series.id, staffTest: false },
  );
  if (draw.shortfall.length || draw.pulls.length < 1) return null;
  const now = new Date();
  // The spin result is the reveal. The card goes straight into My Vault.
  await tx.packOrder.update({
    where: { orderId },
    data: { held: true, finalized: true, packLinesFulfilledAt: now, pullsNotedAt: now },
  });
  await tx.pull.updateMany({ where: { orderId }, data: { status: "REVEALED", revealedAt: now } });
  return draw.pulls[0];
}

/**
 * One spin per customer per Cardbit day. The server rolls, stores the result and awards it in one
 * transaction. Calling again that day (refresh, replay, retry) returns the stored result only.
 */
export async function dailySpin(db: PrismaClient, shop: string, customerId: string, at = new Date()) {
  if (!spinnerEnabled(shop, customerId)) throw new SpinError("The Daily Spinner is not open yet.");
  const day = cardbitDay(at);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "CardbitProfile" (shop, "customerId", "updatedAt") VALUES (${shop}, ${customerId}, NOW()) ON CONFLICT (shop, "customerId") DO NOTHING`;
    await tx.$queryRaw`SELECT "customerId" FROM "CardbitProfile" WHERE shop=${shop} AND "customerId"=${customerId} FOR UPDATE`;
    const stored = await tx.cardbitSpin.findUnique({ where: { shop_customerId_day: { shop, customerId, day } } });
    if (stored) return { ...stored, replay: true };
    const profile = await tx.cardbitProfile.findUniqueOrThrow({ where: { shop_customerId: { shop, customerId } } });
    const tier = spinnerFor(levelProgress(profile.xp).level).id;
    const streak =
      profile.lastCheckInDay === day || profile.lastCheckInDay === previousDay(day) ? profile.streak : 0;
    const table = await spinTable(tx);
    const slices = weightedSlices(table[tier] ?? DEFAULT_SPIN_TABLE[tier], streak);
    let slice: Slice = pickSlice(slices, randomInt(totalWeight(slices)));
    let pullId: string | null = null;
    if (slice.kind === "card") {
      const pull = await drawSpinCard(tx, shop, customerId, tier, day);
      if (pull) pullId = pull.id;
      // An empty pool falls back to the best non-card slice, so a spin always pays something.
      else slice = slices.filter((s) => s.kind !== "card").sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0];
    }
    // Sparks slices pay XP while Sparks are off.
    const kind = slice.kind === "sparks" && !sparksEnabled(shop, customerId) ? "xp" : slice.kind;
    const amount = kind === "card" ? null : slice.amount!;
    const spin = await tx.cardbitSpin.create({
      data: { shop, customerId, day, tier, streak, prizeKind: kind, amount, pullId },
    });
    if (kind === "xp")
      await awardXp(tx, { shop, customerId, eventKey: "spin:" + spin.id, kind: "spin", xp: amount!, source: spin.id });
    if (kind === "sparks") {
      await tx.$executeRaw`INSERT INTO "CardbitSparkWallet" (shop, "customerId") VALUES (${shop}, ${customerId}) ON CONFLICT (shop, "customerId") DO NOTHING`;
      await tx.cardbitSparkTxn.create({
        data: { shop, customerId, eventKey: "spark-spin:" + spin.id, kind: "spin", delta: amount!, source: spin.id },
      });
      await tx.cardbitSparkWallet.update({
        where: { shop_customerId: { shop, customerId } },
        data: { balance: { increment: amount! } },
      });
    }
    return { ...spin, replay: false };
  });
}

export async function todaysSpin(db: PrismaClient, shop: string, customerId: string, at = new Date()) {
  return db.cardbitSpin.findUnique({ where: { shop_customerId_day: { shop, customerId, day: cardbitDay(at) } } });
}
