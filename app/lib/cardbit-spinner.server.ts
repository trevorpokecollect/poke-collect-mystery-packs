import { randomInt, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { featureOn } from "./cardbit-flags.server";
import { SPINNER_TIERS, cardbitDay, levelProgress, previousDay } from "./cardbit-levels";
import { awardXp } from "./cardbit-levels.server";
import { sparksEnabled } from "./cardbit-sparks.server";
import { drawForOrderInTransaction } from "./pool.server";
import { SITE_REWARDS_SHOP } from "./cardbit-flags.server";
import { drawSiteSpinCard, siteSpinCard, siteSpinCards } from "../site/rewards/spin-pools.server";
import {
  DEFAULT_SPIN_TABLE,
  displayOdds,
  fallbackSlice,
  rollAmount,
  pickSlice,
  totalWeight,
  validTable,
  weightedSlices,
  type Slice,
  type SpinTable,
} from "./cardbit-spinner";

type Tx = Prisma.TransactionClient;
export const SPIN_TABLE_KEY = "cardbit:spin-table";
/** The standalone site keeps its own prize table (staff edit it in Card Broker → Pools → Daily Spin Prizes). */
export const SITE_SPIN_TABLE_KEY = "cardbit-site:spin-table";
const isSite = (shop: string) => shop === SITE_REWARDS_SHOP;

/** Off until official rules, a free entry method and Trevor's approval exist (CARDBIT_SPINNER=on; "qa" = QA customers only). */
export const spinnerEnabled = (shop: string, customerId?: string | null, env: NodeJS.ProcessEnv = process.env) =>
  featureOn("CARDBIT_SPINNER", shop, customerId, env);

/** A Daily Spin pool is a series marked in its build rules; it is never sold as a pack. */
export const dailySpinRules = (tier: string) => ({ path: ["cardbitDailySpin"], equals: tier });

export class SpinError extends Error {}

export async function spinTable(db: PrismaClient | Tx, shop?: string): Promise<SpinTable> {
  const keys = shop && isSite(shop) ? [SITE_SPIN_TABLE_KEY, SPIN_TABLE_KEY] : [SPIN_TABLE_KEY];
  for (const key of keys) {
    const row = await db.appValue.findUnique({ where: { key } });
    try {
      const parsed = row ? JSON.parse(row.value) : null;
      if (validTable(parsed)) return { ...DEFAULT_SPIN_TABLE, ...parsed };
    } catch {
      /* try the next key, then the defaults */
    }
  }
  return DEFAULT_SPIN_TABLE;
}

/** When the site's prize table last changed (null = defaults), for the Official Rules. */
export async function siteSpinTableUpdatedAt(db: PrismaClient | Tx) {
  return (await db.appValue.findUnique({ where: { key: SITE_SPIN_TABLE_KEY }, select: { updatedAt: true } }))?.updatedAt ?? null;
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
 * One spin per unlocked tier per customer per Cardbit day. The server rolls, stores the result and
 * awards it in one transaction. Calling again that day (refresh, replay, retry) returns the stored
 * result only.
 */
export async function dailySpin(db: PrismaClient, shop: string, customerId: string, tierId: unknown, at = new Date()) {
  if (!spinnerEnabled(shop, customerId)) throw new SpinError("The Daily Spin is not available right now.");
  const spinner = SPINNER_TIERS.find((t) => t.id === tierId);
  if (!spinner) throw new SpinError("Choose a spin from the list.");
  const tier = spinner.id;
  const day = cardbitDay(at);
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "CardbitProfile" (shop, "customerId", "updatedAt") VALUES (${shop}, ${customerId}, NOW()) ON CONFLICT (shop, "customerId") DO NOTHING`;
    await tx.$queryRaw`SELECT "customerId" FROM "CardbitProfile" WHERE shop=${shop} AND "customerId"=${customerId} FOR UPDATE`;
    const stored = await tx.cardbitSpin.findUnique({
      where: { shop_customerId_day_tier: { shop, customerId, day, tier } },
    });
    if (stored) return { ...stored, replay: true };
    const profile = await tx.cardbitProfile.findUniqueOrThrow({ where: { shop_customerId: { shop, customerId } } });
    if (levelProgress(profile.xp).level < spinner.minLevel)
      throw new SpinError(`Reach Level ${spinner.minLevel} to unlock the ${spinner.name}.`);
    const streak =
      profile.lastCheckInDay === day || profile.lastCheckInDay === previousDay(day) ? profile.streak : 0;
    const table = await spinTable(tx, shop);
    const slices = weightedSlices(table[tier] ?? DEFAULT_SPIN_TABLE[tier], streak);
    let slice: Slice = pickSlice(slices, randomInt(totalWeight(slices)));
    let pullId: string | null = null;
    let copyId: string | null = null;
    let valueBits: number | null = null;
    const spinId = randomUUID();
    if (slice.kind === "card") {
      if (isSite(shop)) {
        const won = await drawSiteSpinCard(tx, shop, customerId, tier, spinId);
        if (won) ({ copyId, valueBits } = won);
      } else {
        const pull = await drawSpinCard(tx, shop, customerId, tier, day);
        if (pull) pullId = pull.id;
      }
      // An empty pool (or a card over the prize caps) pays the best Sparks result, so a spin always pays something.
      if (!pullId && !copyId) slice = fallbackSlice(slices);
    }
    // Sparks slices pay XP while Sparks are off.
    const kind = slice.kind === "sparks" && !sparksEnabled(shop, customerId) ? "xp" : slice.kind;
    const amount = kind === "card" ? null : rollAmount(slice, (n) => randomInt(n));
    const spin = await tx.cardbitSpin.create({
      data: { id: spinId, shop, customerId, day, tier, streak, prizeKind: kind, amount, pullId, copyId, valueBits },
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
  return { ...result, card: isSite(shop) ? await siteSpinCard(db, result.copyId) : await spinCard(db, result.pullId) };
}

/** The won card's public details (no value): title, image and rarity. */
async function spinCard(db: PrismaClient, pullId: string | null) {
  if (!pullId) return null;
  const pull = await db.pull.findUnique({
    where: { id: pullId },
    select: { slot: { select: { card: { select: { title: true, imageUrl: true, tier: true } } } } },
  });
  return pull ? pull.slot.card : null;
}

/** Cards a tier can land on today: the remaining copies in its live Daily Spin pools. */
async function spinCards(db: PrismaClient, shop: string, tier: string) {
  const series = await db.series.findMany({
    where: { shop, status: "LIVE", staffTest: false, buildRules: dailySpinRules(tier) },
    select: {
      cards: {
        select: {
          title: true,
          imageUrl: true,
          tier: true,
          _count: { select: { slots: { where: { claimed: false, voided: false } } } },
        },
      },
    },
  });
  return series
    .flatMap((s) => s.cards)
    .filter((c) => c._count.slots > 0)
    .map((c) => ({ title: c.title, imageUrl: c.imageUrl, rarity: c.tier, left: c._count.slots }));
}

/**
 * Every Daily Spin tier for the rewards page: whether it is unlocked, today's stored result, and
 * what it can land on with the odds of the current table (card odds already include the streak).
 */
export async function spinsView(
  db: PrismaClient,
  shop: string,
  customerId: string,
  level: number,
  streak: number,
  at = new Date(),
) {
  const day = cardbitDay(at);
  const [table, today] = await Promise.all([
    spinTable(db, shop),
    db.cardbitSpin.findMany({ where: { shop, customerId, day } }),
  ]);
  const sparksOn = sparksEnabled(shop, customerId);
  return Promise.all(
    SPINNER_TIERS.map(async (t) => {
      const slices = weightedSlices(table[t.id] ?? DEFAULT_SPIN_TABLE[t.id], streak);
      const cards = isSite(shop) ? await siteSpinCards(db, shop, t.id) : await spinCards(db, shop, t.id);
      const usable = cards.length ? slices : slices.filter((s) => s.kind !== "card");
      const odds = displayOdds(usable).map((o) => (o.kind === "sparks" && !sparksOn ? { ...o, kind: "xp" as const } : o));
      const done = today.find((s) => s.tier === t.id) ?? null;
      return {
        ...t,
        unlocked: level >= t.minLevel,
        result: done ? { prizeKind: done.prizeKind, amount: done.amount, card: isSite(shop) ? await siteSpinCard(db, done.copyId) : await spinCard(db, done.pullId) } : null,
        odds,
        cards: cards.slice(0, 40),
      };
    }),
  );
}
