// Pack Pass perks beyond Cardbits/XP/Sparks (Trevor, Nov 25 2026):
// - Free Ship Together: Pro waives the shipping fee on one shipment per calendar month (Central time);
//   Ultimate waives it on every shipment. Use is recorded as a SitePlayEvent "pass_free_ship".
// - Buyback bonus: Ultimate members get +5% of market on every buyback offer (85% instead of 80%).
// None of these touch odds, spins, giveaway entries or leaderboard points.
import type { Prisma, PrismaClient } from "@prisma/client";
import { activeTier } from "./subscriptions.server";

type Db = PrismaClient | Prisma.TransactionClient;
export const FREE_SHIP_EVENT = "pass_free_ship";
export const ULTIMATE_BUYBACK_BONUS = 0.05;

/** First instant of the current calendar month in America/Chicago. */
export function centralMonthStart(now = new Date()): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", timeZoneName: "longOffset" })
      .formatToParts(now).map((p) => [p.type, p.value]),
  );
  const offset = /GMT([+-]\d{2}):?(\d{2})?/.exec(parts.timeZoneName ?? "") ?? [];
  const sign = offset[1]?.startsWith("-") ? -1 : 1;
  const mins = offset[1] ? sign * (Math.abs(Number(offset[1])) * 60 + Number(offset[2] ?? 0)) : -360;
  // Midnight local on the 1st, shifted by the offset in effect now (DST changes never fall on the 1st at midnight).
  const firstLocal = Date.UTC(Number(parts.year), Number(parts.month) - 1, 1);
  const start = new Date(firstLocal - mins * 60_000);
  // If the month began under a different offset (e.g. the 1st is in standard time but now is DST), correct it.
  const startParts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(start);
  const hour = Number(startParts.find((p) => p.type === "hour")?.value ?? 0);
  const day = Number(startParts.find((p) => p.type === "day")?.value ?? 1);
  if (day !== 1) return new Date(start.getTime() + (24 - hour) * 3_600_000);
  return hour ? new Date(start.getTime() - hour * 3_600_000) : start;
}

export type FreeShip = { kind: "unlimited" | "monthly"; tier: "pro" | "ultimate" } | null;

/** Whether the member's next shipment ships free through Pack Pass. */
export async function passFreeShip(db: Db, customerId: string, now = new Date()): Promise<FreeShip> {
  const tier = await activeTier(db as PrismaClient, customerId, now);
  if (tier?.id === "ultimate") return { kind: "unlimited", tier: "ultimate" };
  if (tier?.id !== "pro") return null;
  const used = await db.sitePlayEvent.count({ where: { customerId, kind: FREE_SHIP_EVENT, createdAt: { gte: centralMonthStart(now) } } });
  return used ? null : { kind: "monthly", tier: "pro" };
}

/**
 * Claim the waiver for a shipment inside its transaction. Serialized per customer, so two shipments
 * sent at once can't both use a Pro member's monthly free one. Returns false when it's already used.
 */
export async function claimFreeShip(tx: Prisma.TransactionClient, customerId: string, shipmentId: string, perk: NonNullable<FreeShip>, now = new Date()) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"pass-free-ship:" + customerId}, 0))`;
  if (perk.kind === "monthly") {
    const used = await tx.sitePlayEvent.count({ where: { customerId, kind: FREE_SHIP_EVENT, createdAt: { gte: centralMonthStart(now) } } });
    if (used) return false;
  }
  await tx.sitePlayEvent.create({ data: { customerId, kind: FREE_SHIP_EVENT, detail: { shipmentId, tier: perk.tier, kind: perk.kind }, createdAt: now } });
  return true;
}

/**
 * The sell-back offer for a member. Offers are 80% of market (or Poke-Collect's own offer); Ultimate gets the
 * same offer scaled to 85% of market (x 85/80, rounded down), never above the card's retail price.
 */
export function memberBuyback(base: number | null, bonus: number, retail: number | null = null): number | null {
  if (base == null || base <= 0 || !bonus) return base;
  const up = Math.floor((base * (0.8 + bonus)) / 0.8);
  return retail != null && retail > 0 ? Math.max(base, Math.min(up, retail)) : up;
}

/** Extra share of market on sell-backs for this member: 0, or 0.05 on Ultimate. */
export async function buybackBonusFor(db: Db, customerId: string | null | undefined, now = new Date()) {
  if (!customerId) return 0;
  const tier = await activeTier(db as PrismaClient, customerId, now);
  return tier?.id === "ultimate" ? ULTIMATE_BUYBACK_BONUS : 0;
}
