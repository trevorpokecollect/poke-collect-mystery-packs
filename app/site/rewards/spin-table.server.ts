// Daily Spin prize table for the standalone site, edited in Card Broker → Pools → Daily Spin Prizes (Trevor, Nov 26
// 2026: "the spin pool options also need to include XP and Spark ranges"). Each spin has one card result (drawn
// from its prize pool) and any number of Sparks and XP results, each a fixed amount or a min–max range rolled evenly.
// The Official Rules prize table is drawn from this same table, so what staff save is what the rules say.
import type { PrismaClient } from "@prisma/client";
import { SPINNER_TIERS } from "../../lib/cardbit-levels";
import { DEFAULT_SPIN_TABLE, STREAK_CARD_BONUS, displayOdds, validTable, weightedSlices, type Slice, type SpinTable } from "../../lib/cardbit-spinner";
import { SITE_SPIN_TABLE_KEY, siteSpinTableUpdatedAt, spinTable } from "../../lib/cardbit-spinner.server";
import { SITE_SHOP } from "./rewards.server";
import { SPIN_CARD_CAP_BITS, spinPoolId } from "./spin-pools.server";

export class SpinTableError extends Error {}

const MAX_RESULTS = 8;

/** Staff view: every spin's results with base odds and odds at a full streak, plus its pool and card cap. */
export async function siteSpinTableView(db: PrismaClient) {
  const [table, updatedAt, pools] = await Promise.all([
    spinTable(db, SITE_SHOP),
    siteSpinTableUpdatedAt(db),
    db.siteCopy.groupBy({ by: ["packId"], where: { status: "POOLED", packId: { startsWith: "spin-" } }, _count: { _all: true } }),
  ]);
  return {
    updatedAt: updatedAt?.toISOString() ?? null,
    streak: STREAK_CARD_BONUS,
    tiers: SPINNER_TIERS.map((t) => {
      const slices = table[t.id] ?? DEFAULT_SPIN_TABLE[t.id];
      return {
        id: t.id,
        name: t.name,
        minLevel: t.minLevel,
        poolId: spinPoolId(t.id),
        poolCards: pools.find((p) => p.packId === spinPoolId(t.id))?._count._all ?? 0,
        cardCapBits: SPIN_CARD_CAP_BITS[t.id] ?? null,
        results: slices.map((s) => ({ kind: s.kind, min: s.amount ?? null, max: s.max ?? s.amount ?? null, weight: s.weight })),
        odds: displayOdds(slices),
        oddsFullStreak: displayOdds(weightedSlices(slices, STREAK_CARD_BONUS.maxDays)),
      };
    }),
  };
}

/**
 * Save one spin's results. Input: [{kind: "card"|"sparks"|"xp", min?, max?, weight}]. Exactly one card result
 * (weight 0 turns card prizes off for that spin), at least one Sparks or XP result, amounts 1–10,000.
 */
export async function saveSiteSpinTier(db: PrismaClient, tierId: unknown, rows: unknown) {
  const tier = SPINNER_TIERS.find((t) => t.id === tierId);
  if (!tier) throw new SpinTableError("Choose a spin.");
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_RESULTS) throw new SpinTableError(`Give each spin 2 to ${MAX_RESULTS} results.`);
  const slices: Slice[] = rows.map((r: { kind?: unknown; min?: unknown; max?: unknown; weight?: unknown }) => {
    const kind = r?.kind;
    if (kind !== "card" && kind !== "sparks" && kind !== "xp") throw new SpinTableError("Each result is a Card, Sparks or XP.");
    const weight = Number(r.weight);
    if (!Number.isInteger(weight) || weight < 0 || weight > 1_000_000) throw new SpinTableError("Weights are whole numbers from 0 to 1,000,000.");
    if (kind === "card") return { kind, weight };
    const min = Number(r.min);
    const max = r.max === null || r.max === undefined || r.max === "" ? min : Number(r.max);
    if (!Number.isInteger(min) || min < 1 || min > 10_000 || !Number.isInteger(max) || max < min || max > 10_000)
      throw new SpinTableError(`${kind === "sparks" ? "Sparks" : "XP"} amounts are whole numbers from 1 to 10,000, with the minimum at or below the maximum.`);
    return max > min ? { kind, amount: min, max, weight } : { kind, amount: min, weight };
  });
  if (slices.filter((s) => s.kind === "card").length !== 1) throw new SpinTableError("Each spin has exactly one Card result (set its weight to 0 to turn card prizes off).");
  if (!slices.some((s) => s.kind === "sparks")) throw new SpinTableError("Each spin needs at least one Sparks result (an empty prize pool pays the top Sparks result).");
  if (!slices.some((s) => s.weight > 0)) throw new SpinTableError("At least one result needs a weight above 0.");
  const current = await spinTable(db, SITE_SHOP);
  const next: SpinTable = { ...current, [tier.id]: slices };
  if (!validTable(next)) throw new SpinTableError("Check the results and try again.");
  await db.appValue.upsert({
    where: { key: SITE_SPIN_TABLE_KEY },
    create: { key: SITE_SPIN_TABLE_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  return siteSpinTableView(db);
}
