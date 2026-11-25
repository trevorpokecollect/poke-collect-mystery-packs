// Rewards on the standalone site: Levels/XP, daily check-in, Latch & Friends icons, Daily Spins,
// Sparks and the Weekly Leaderboard. The same engagement code as the Shopify store runs here, with
// the site's own shop key (SITE_REWARDS_SHOP) and site customer ids, so the two never mix.
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { SITE_REWARDS_SHOP, featureOn } from "../../lib/cardbit-flags.server";
import { awardPackXp, levelsEnabled, reverseXp } from "../../lib/cardbit-levels.server";
import { defaultColor, levelProgress } from "../../lib/cardbit-levels";
import { sparksForOpening } from "../../lib/cardbit-sparks";
import { WEEKLY_PRIZES, weekWindow } from "../../lib/cardbit-leaderboard.server";

type Tx = Prisma.TransactionClient;
export const SITE_SHOP = SITE_REWARDS_SHOP;

export const siteLevelsOn = () => levelsEnabled(SITE_SHOP, null);
export const siteSparksOn = (env: NodeJS.ProcessEnv = process.env) => featureOn("CARDBIT_SPARKS", SITE_SHOP, null, env);
export const siteLeaderboardOn = (env: NodeJS.ProcessEnv = process.env) => featureOn("CARDBIT_LEADERBOARD", SITE_SHOP, null, env);

/**
 * XP and Sparks for one paid, non-demo site opening. Call inside the opening's transaction.
 * Idempotent on the opening id: a retried transaction or replayed request never awards twice.
 * XP: 25 per pack plus spend XP (same rules as Shopify). Sparks: 5% of the gap when the drawn
 * cards' buyback value is below the Cardbits paid.
 */
export async function siteRewardsForOpening(
  tx: Tx,
  customerId: string,
  openingId: string,
  paidBits: number,
  pulledBuybackBits: number,
) {
  if (!Number.isSafeInteger(paidBits) || paidBits <= 0) return { xp: 0, sparks: 0 };
  const key = "site-open:" + openingId;
  const xp = (await awardPackXp(tx, SITE_SHOP, customerId, key, paidBits))?.xp ?? 0;
  let sparks = 0;
  if (siteSparksOn()) {
    const eventKey = "spark:" + key;
    const existing = await tx.cardbitSparkTxn.findUnique({ where: { shop_eventKey: { shop: SITE_SHOP, eventKey } } });
    if (existing) sparks = existing.delta;
    else {
      const amount = sparksForOpening(paidBits, Math.max(0, Math.floor(pulledBuybackBits || 0)));
      if (amount > 0) {
        await tx.$executeRaw`INSERT INTO "CardbitSparkWallet" (shop, "customerId") VALUES (${SITE_SHOP}, ${customerId}) ON CONFLICT (shop, "customerId") DO NOTHING`;
        await tx.$queryRaw`SELECT "customerId" FROM "CardbitSparkWallet" WHERE shop=${SITE_SHOP} AND "customerId"=${customerId} FOR UPDATE`;
        await tx.cardbitSparkTxn.create({
          data: { shop: SITE_SHOP, customerId, eventKey, kind: "award", delta: amount, source: openingId, note: `paid ${paidBits}, pulled value ${pulledBuybackBits}` },
        });
        await tx.cardbitSparkWallet.update({
          where: { shop_customerId: { shop: SITE_SHOP, customerId } },
          data: { balance: { increment: amount } },
        });
        sparks = amount;
      }
    }
  }
  return { xp, sparks };
}

export type OpeningRewards = { xp: number; sparks: number };
const xpKey = (openingId: string) => "pack:site-open:" + openingId;
const sparkKey = (openingId: string) => "spark:site-open:" + openingId;
// Cardbit Club bonus on top of the base award (see subscriberBonusForOpening).
const subXpKey = (openingId: string) => "sub-xp:site-open:" + openingId;
const subSparkKey = (openingId: string) => "sub-spark:site-open:" + openingId;

/** XP and Sparks already earned by each opening (read-only; replays never award again). */
export async function openingRewards(db: PrismaClient | Tx, customerId: string, openingIds: string[]) {
  const out = new Map<string, OpeningRewards>();
  if (!openingIds.length) return out;
  const [xp, sparks] = await Promise.all([
    db.cardbitXpEvent.findMany({ where: { shop: SITE_SHOP, customerId, eventKey: { in: openingIds.flatMap((id) => [xpKey(id), subXpKey(id)]) } }, select: { eventKey: true, xp: true } }),
    db.cardbitSparkTxn.findMany({ where: { shop: SITE_SHOP, customerId, eventKey: { in: openingIds.flatMap((id) => [sparkKey(id), subSparkKey(id)]) } }, select: { eventKey: true, delta: true } }),
  ]);
  for (const id of openingIds) {
    const x = xp.filter((e) => e.eventKey === xpKey(id) || e.eventKey === subXpKey(id)).reduce((n, e) => n + e.xp, 0);
    const s = sparks.filter((e) => e.eventKey === sparkKey(id) || e.eventKey === subSparkKey(id)).reduce((n, e) => n + e.delta, 0);
    if (x || s) out.set(id, { xp: x, sparks: s });
  }
  return out;
}

/** Level progress and Sparks balance for the header and the reveal. Null parts are switched off. */
export async function siteProgress(db: PrismaClient | Tx, customerId: string) {
  const levels = siteLevelsOn(), sparksOn = siteSparksOn();
  const [profile, wallet] = await Promise.all([
    levels ? db.cardbitProfile.findUnique({ where: { shop_customerId: { shop: SITE_SHOP, customerId } }, select: { xp: true } }) : null,
    sparksOn ? db.cardbitSparkWallet.findUnique({ where: { shop_customerId: { shop: SITE_SHOP, customerId } }, select: { balance: true } }) : null,
  ]);
  return { level: levels ? levelProgress(profile?.xp ?? 0) : null, sparks: sparksOn ? wallet?.balance ?? 0 : null };
}

/** Wipe Demo: take back the XP and Sparks that demo openings earned, once each. */
export async function reverseOpeningRewards(tx: Tx, openingIds: string[], reason: string) {
  for (const id of openingIds) {
    await reverseXp(tx, SITE_SHOP, xpKey(id), reason);
    const award = await tx.cardbitSparkTxn.findUnique({ where: { shop_eventKey: { shop: SITE_SHOP, eventKey: sparkKey(id) } } });
    if (!award || award.delta <= 0) continue;
    const eventKey = "reverse:" + sparkKey(id);
    if (await tx.cardbitSparkTxn.findUnique({ where: { shop_eventKey: { shop: SITE_SHOP, eventKey } } })) continue;
    await tx.$queryRaw`SELECT "customerId" FROM "CardbitSparkWallet" WHERE shop=${SITE_SHOP} AND "customerId"=${award.customerId} FOR UPDATE`;
    const wallet = await tx.cardbitSparkWallet.findUnique({ where: { shop_customerId: { shop: SITE_SHOP, customerId: award.customerId } } });
    const take = Math.min(award.delta, Math.max(0, wallet?.balance ?? 0));
    await tx.cardbitSparkTxn.create({ data: { shop: SITE_SHOP, customerId: award.customerId, eventKey, kind: "reversal", delta: -take, source: id, note: reason } });
    if (take) await tx.cardbitSparkWallet.update({ where: { shop_customerId: { shop: SITE_SHOP, customerId: award.customerId } }, data: { balance: { decrement: take } } });
  }
}

export const alias = (customerId: string) =>
  "Collector " + createHash("sha256").update(customerId).digest("hex").slice(0, 4).toUpperCase();

/**
 * Weekly Leaderboard for the site: Cardbits spent on paid pack openings this week (Monday to Sunday,
 * Central), net of refunds of those openings. Demo openings never count. Prizes are not paid here.
 */
export async function siteWeeklyStandings(db: PrismaClient, viewerId?: string | null, at = new Date()) {
  const { start, end } = weekWindow(at);
  const debits = await db.siteLedger.findMany({
    where: { kind: "PACK", createdAt: { gte: start, lt: end }, ref: { not: null } },
    select: { customerId: true, delta: true, ref: true },
  });
  const refs = [...new Set(debits.map((d) => d.ref!))];
  const [demo, refunds] = await Promise.all([
    refs.length ? db.siteOpening.findMany({ where: { id: { in: refs }, demo: true }, select: { id: true } }) : [],
    refs.length ? db.siteLedger.findMany({ where: { kind: "REFUND", ref: { in: refs } }, select: { customerId: true, delta: true } }) : [],
  ]);
  const demoIds = new Set(demo.map((d) => d.id));
  const totals = new Map<string, number>();
  for (const d of debits) if (!demoIds.has(d.ref!)) totals.set(d.customerId, (totals.get(d.customerId) ?? 0) - d.delta);
  for (const r of refunds) if (totals.has(r.customerId)) totals.set(r.customerId, totals.get(r.customerId)! - r.delta);
  const ranked = [...totals]
    .map(([customerId, score]) => ({ customerId, score }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.customerId.localeCompare(b.customerId));
  const top = ranked.slice(0, 25);
  const profiles = top.length
    ? await db.cardbitProfile.findMany({
        where: { shop: SITE_SHOP, customerId: { in: top.map((r) => r.customerId) } },
        select: { customerId: true, iconId: true, iconColor: true },
      })
    : [];
  const mine = viewerId ? ranked.findIndex((r) => r.customerId === viewerId) : -1;
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    prizes: WEEKLY_PRIZES,
    top: top.map((r, i) => {
      const p = profiles.find((x) => x.customerId === r.customerId);
      return { rank: i + 1, name: alias(r.customerId), iconId: p?.iconId ?? null, color: p?.iconColor ?? defaultColor(r.customerId), score: r.score, you: r.customerId === viewerId };
    }),
    you: mine >= 0 ? { rank: mine + 1, score: ranked[mine].score } : null,
  };
}
