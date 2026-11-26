// Pack Pass perks beyond Cardbits/XP/Sparks (Trevor, Nov 25 2026):
// - Free Ship Together: the shipping fee is waived on 1 shipment per calendar month (Central time) on Pro and
//   2 on Ultimate (Trevor, Nov 26: unlimited would hurt margins). Use is recorded as a SitePlayEvent "pass_free_ship".
// - Buyback bonus: Ultimate members get +5% Cardbits on every buyback offer (whatever the base rate is).
// None of these touch odds, spins, giveaway entries or leaderboard points.
import type { Prisma, PrismaClient } from "@prisma/client";
import { activeTier } from "./subscriptions.server";

type Db = PrismaClient | Prisma.TransactionClient;
export const FREE_SHIP_EVENT = "pass_free_ship";
export const ULTIMATE_BUYBACK_BONUS = 0.05;
export const FREE_SHIPS_PER_MONTH = { pro: 1, ultimate: 2 } as const;

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

export type FreeShip = { kind: "monthly"; tier: "pro" | "ultimate"; left: number } | null;

const usedThisMonth = (db: Db, customerId: string, now: Date) =>
  db.sitePlayEvent.count({ where: { customerId, kind: FREE_SHIP_EVENT, createdAt: { gte: centralMonthStart(now) } } });

/** Whether the member's next shipment ships free through Pack Pass. */
export async function passFreeShip(db: Db, customerId: string, now = new Date()): Promise<FreeShip> {
  const tier = await activeTier(db as PrismaClient, customerId, now);
  if (tier?.id !== "pro" && tier?.id !== "ultimate") return null;
  const left = FREE_SHIPS_PER_MONTH[tier.id] - (await usedThisMonth(db, customerId, now));
  return left > 0 ? { kind: "monthly", tier: tier.id, left } : null;
}

/**
 * Claim the waiver for a shipment inside its transaction. Serialized per customer, so two shipments
 * sent at once can't go past the member's monthly free shipments. Returns false when it's already used.
 */
export async function claimFreeShip(tx: Prisma.TransactionClient, customerId: string, shipmentId: string, perk: NonNullable<FreeShip>, now = new Date()) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"pass-free-ship:" + customerId}, 0))`;
  if ((await usedThisMonth(tx, customerId, now)) >= FREE_SHIPS_PER_MONTH[perk.tier]) return false;
  await tx.sitePlayEvent.create({ data: { customerId, kind: FREE_SHIP_EVENT, detail: { shipmentId, tier: perk.tier, kind: perk.kind }, createdAt: now } });
  return true;
}

/**
 * The sell-back offer for a member: Ultimate gets +5% Cardbits on top of the regular offer (rounded down),
 * never above the card's retail price. Copy says "+5% Cardbits", never a fixed rate (the base can change).
 */
export function memberBuyback(base: number | null, bonus: number, retail: number | null = null): number | null {
  if (base == null || base <= 0 || !bonus) return base;
  const up = Math.floor(base * (1 + bonus));
  return retail != null && retail > 0 ? Math.max(base, Math.min(up, retail)) : up;
}

/** Extra share of market on sell-backs for this member: 0, or 0.05 on Ultimate. */
export async function buybackBonusFor(db: Db, customerId: string | null | undefined, now = new Date()) {
  if (!customerId) return 0;
  const tier = await activeTier(db as PrismaClient, customerId, now);
  return tier?.id === "ultimate" ? ULTIMATE_BUYBACK_BONUS : 0;
}
