// Rewards on the standalone site: Levels/XP, daily check-in, Latch & Friends icons, Daily Spins,
// Sparks and the Weekly Leaderboard. The same engagement code as the Shopify store runs here, with
// the site's own shop key (SITE_REWARDS_SHOP) and site customer ids, so the two never mix.
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { SITE_REWARDS_SHOP, featureOn } from "../../lib/cardbit-flags.server";
import { awardPackXp, levelsEnabled } from "../../lib/cardbit-levels.server";
import { defaultColor } from "../../lib/cardbit-levels";
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
  if (!Number.isSafeInteger(paidBits) || paidBits <= 0) return { xp: null, sparks: 0 };
  const key = "site-open:" + openingId;
  const xp = await awardPackXp(tx, SITE_SHOP, customerId, key, paidBits);
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
