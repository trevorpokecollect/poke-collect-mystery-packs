// Verified restocks (Trevor, Nov 25 2026). A pack pool changes only when staff publish a restock:
// - Staff stage Draft cards to add (new stock or buybacks) and pooled cards to remove (damaged, mispriced).
//   A staged copy is locked to that restock (SiteCopy.restockId), so it can't be listed, staged twice or
//   added to another pool. Staged removals stay in the pool, and can still be pulled, until publish.
// - Publish (instant, Trevor chose "Instant, logged") applies every staged change in one transaction under
//   the pack lock that openings also take, then saves a numbered pool version: the full list of copy ids
//   left in the pool (ascending) and its SHA-256 hash. Each opening records the version it drew from.
// - Version 1 is the starting pool, recorded automatically the first time it's needed.
// Anyone can recheck an opening: its pool must be that version's list minus the cards pulled since.
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient, SiteCopy } from "@prisma/client";
const Prisma_DbNull = Prisma.DbNull;
import { priceKey } from "./stock.server";
import { autoTierRules, DEFAULT_MIX, tierFor, tierMix, tierRules, type TierRule } from "../store/tiers";

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

export class RestockError extends Error {}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** Pool hash: SHA-256 of the copy ids, ascending, one per line. The browser verifier uses the same rule. */
export const poolHashOf = (ids: readonly string[]) => sha256([...ids].sort(cmp).join("\n"));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const cleanIds = (copyIds: unknown) =>
  [...new Set((Array.isArray(copyIds) ? copyIds : []).filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 60))].slice(0, 500);

export async function lockPack(tx: Tx, packId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`site-pack:${packId}`}, 0))::text`;
}

async function packOrThrow(db: Db, packId: string) {
  const pack = await db.sitePack.findUnique({ where: { id: packId } });
  if (!pack) throw new RestockError("Choose a pack.");
  return pack;
}

/** The pack's open restock, created on first use (one per pack, enforced by a partial unique index). */
async function stagedRestock(tx: Tx, packId: string) {
  const cur = await tx.siteRestock.findFirst({ where: { packId, status: "STAGED" } });
  if (cur) return cur;
  return tx.siteRestock.create({ data: { packId } });
}

async function tierCounts(db: Db, copies: Pick<SiteCopy, "printingKey" | "condition" | "retailBits">[], rules: TierRule[]) {
  const keys = [...new Set(copies.map((c) => priceKey(c.printingKey, c.condition)))];
  const prices = keys.length ? await db.sitePrice.findMany({ where: { printingKey: { in: keys } } }) : [];
  const byKey = new Map(prices.map((p) => [p.printingKey, p]));
  const out: Record<string, number> = {};
  for (const c of copies) {
    const p = byKey.get(priceKey(c.printingKey, c.condition));
    const t = tierFor(c.retailBits ?? p?.retailBits ?? p?.buybackBits ?? null, rules) ?? "Unpriced";
    out[t] = (out[t] ?? 0) + 1;
  }
  return out;
}

/** Record version 1 (the starting pool) if this pack has no published version yet. Caller holds the pack lock. */
export async function ensureBaseline(tx: Tx, packId: string, actor = "system") {
  const live = await tx.siteRestock.findFirst({ where: { packId, status: "LIVE" }, orderBy: { version: "desc" } });
  if (live) return live;
  const pool = await tx.siteCopy.findMany({ where: { packId, status: "POOLED" }, select: { id: true, printingKey: true, condition: true, retailBits: true } });
  const tiered = await recomputeTiers(tx, packId);
  const rules = tiered ? tiered.rules : tierRules((await tx.sitePack.findUnique({ where: { id: packId }, select: { tierRules: true } }))?.tierRules);
  const ids = pool.map((c) => c.id).sort(cmp);
  return tx.siteRestock.create({
    data: {
      packId,
      status: "LIVE",
      version: 1,
      addIds: ids,
      poolIds: ids,
      poolHash: poolHashOf(ids),
      poolSize: ids.length,
      tiers: await tierCounts(tx, pool, rules),
      tierRules: rules,
      note: "Starting Pool",
      actor,
      liveAt: new Date(),
    },
  });
}

/** Version number in force for a pack (records the starting pool if needed). Caller holds the pack lock. */
export async function currentPoolVersion(tx: Tx, packId: string) {
  return (await ensureBaseline(tx, packId)).version!;
}

// ---------- Pool rules (Trevor, Nov 25 2026) ----------

type RulePack = { languages: unknown; eras: unknown; minValueBits: number | null; maxValueBits: number | null; typeCaps: unknown; id?: string; kind?: string };

// ---------- Prize pools (Trevor, Nov 26 2026) ----------
// Daily Spin pools (kind "spin", id "spin-<tier>") and the Spark Shop (kind "sparks") use every pack-pool tool,
// but they're never sold, so they have no price or EV. Instead, Fill Rules keep about N cards in each value range.

/** Official Rules C4: maximum value of one card prize per Daily Spin (Cardbits). Mirrors rewards/spin-pools.server.ts. */
export const SPIN_CAPS: Record<string, number> = { "spin-basic": 500, "spin-bronze": 750, "spin-silver": 1000, "spin-gold": 2500, "spin-cobalt": 5000, "spin-holo": 10000 };
export const isPrizePool = (p: { kind?: string | null }) => p.kind != null && p.kind !== "pack";
export type FillTarget = { minBits: number; maxBits: number | null; count: number };
/** Saved Fill Rules, lowest range first. Bad rows are dropped. */
export function fillTargets(raw: unknown): FillTarget[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => ({ minBits: Number(r?.minBits), maxBits: r?.maxBits == null || r?.maxBits === "" ? null : Number(r.maxBits), count: Number(r?.count) }))
    .filter((r) => Number.isInteger(r.minBits) && r.minBits >= 0 && (r.maxBits === null || (Number.isInteger(r.maxBits) && r.maxBits >= r.minBits)) && Number.isInteger(r.count) && r.count > 0)
    .sort((a, b) => a.minBits - b.minBits);
}
export const inRange = (v: number, t: FillTarget) => v >= t.minBits && (t.maxBits == null || v <= t.maxBits);
const TYPES = ["English", "Japanese", "Modern", "Vintage"] as const;
type Mix = Record<string, number>;

/** Why a card can't join this pack's pool (null = it can). Value is Poke-Collect retail in Cardbits. */
export function ruleBreak(pack: RulePack, c: Pick<SiteCopy, "language" | "era" | "setName">, value: number | null) {
  if (!eligible(pack, c)) return "Not an eligible language or era for this pack.";
  if ((pack.minValueBits != null || pack.maxValueBits != null) && (value == null || value <= 0)) return "No price yet, so it can't be checked against this pack's value range.";
  if (pack.minValueBits != null && value! < pack.minValueBits) return `Below this pack's minimum value (${pack.minValueBits.toLocaleString("en-US")} Cardbits).`;
  if (pack.maxValueBits != null && value! > pack.maxValueBits) return `Above this pack's maximum value (${pack.maxValueBits.toLocaleString("en-US")} Cardbits).`;
  const cap = pack.kind === "spin" && pack.id ? SPIN_CAPS[pack.id] : undefined;
  if (cap != null && (value == null || value <= 0)) return "No price yet, so it can't be checked against this spin's prize cap.";
  if (cap != null && value! > cap) return `Above this spin's maximum card prize in the Official Rules (${cap.toLocaleString("en-US")} Cardbits).`;
  return null;
}
const caps = (pack: RulePack): Mix => {
  const raw = pack.typeCaps && typeof pack.typeCaps === "object" ? (pack.typeCaps as Record<string, unknown>) : {};
  const out: Mix = {};
  for (const t of TYPES) if (Number.isFinite(Number(raw[t])) && raw[t] !== null && raw[t] !== "") out[t] = Number(raw[t]);
  return out;
};
export const hasCaps = (pack: RulePack) => Object.keys(caps(pack)).length > 0;
const typesOf = (c: Pick<SiteCopy, "language" | "era" | "setName">) => [c.language.toLowerCase() === "japanese" ? "Japanese" : "English", eraOf(c)];
export function typeCounts(cards: Pick<SiteCopy, "language" | "era" | "setName">[]): Mix {
  const out: Mix = { English: 0, Japanese: 0, Modern: 0, Vintage: 0 };
  for (const c of cards) for (const t of typesOf(c)) out[t]++;
  return out;
}
const addType = (m: Mix, c: Pick<SiteCopy, "language" | "era" | "setName">) => {
  const out = { ...m };
  for (const t of typesOf(c)) out[t] = (out[t] ?? 0) + 1;
  return out;
};
/** Which mix cap (max % of the pool per type) a pool of `total` cards with counts `m` would break. */
export function capBreak(pack: RulePack, m: Mix, total: number) {
  if (!total) return null;
  for (const [t, max] of Object.entries(caps(pack))) {
    // A cap can't stop the first few cards of a type in a tiny pool: allow at least one.
    if ((m[t] ?? 0) > 1 && ((m[t] ?? 0) / total) * 100 > max) return `${t} cards would be more than ${max}% of this pool.`;
  }
  return null;
}

// ---------- Auto-scaling tiers ----------

/**
 * Recompute a pack's tier cutoffs from its current pool (rank by value, fixed mix). Pulls made under the old
 * cutoffs are stamped with the tier they had first, so a pull's tier never changes. Caller holds the pack lock.
 */
export async function recomputeTiers(tx: Tx, packId: string) {
  const pack = await tx.sitePack.findUnique({ where: { id: packId } });
  if (!pack) return null;
  const pool = await tx.siteCopy.findMany({ where: { packId, status: "POOLED" }, select: { printingKey: true, condition: true, retailBits: true } });
  const auto = autoTierRules(await retailOf(tx, pool), tierMix(pack.tierMix), pack.topTierMin);
  if (!auto.cards) return { ...auto, rules: tierRules(pack.tierRules), pack }; // empty or unpriced pool: keep the last cutoffs
  const oldRules = tierRules(pack.tierRules);
  const openings = await tx.siteOpening.findMany({ where: { packId }, select: { id: true } });
  const unstamped = openings.length
    ? await tx.siteCopy.findMany({ where: { pulledTier: null, openingId: { in: openings.map((o) => o.id) } }, select: { id: true, printingKey: true, condition: true, retailBits: true } })
    : [];
  if (unstamped.length) {
    const vals = await retailOf(tx, unstamped);
    for (const [i, c] of unstamped.entries()) await tx.siteCopy.update({ where: { id: c.id }, data: { pulledTier: tierFor(vals[i], oldRules) ?? "Unpriced" } });
  }
  await tx.sitePack.update({ where: { id: packId }, data: { tierRules: auto.rules, tiersAt: new Date() } });
  return { ...auto, pack: { ...pack, tierRules: auto.rules } };
}

/**
 * Stage copies for the pack's next restock: "add" takes unowned Draft copies, "remove" takes copies in this
 * pack's pool. Copies already staged (here or for another pack), listed, vaulted or locked are skipped.
 */
export async function stageRestock(db: PrismaClient, actor: string, packId: string, copyIds: unknown, mode: "add" | "remove") {
  await packOrThrow(db, packId);
  const ids = cleanIds(copyIds);
  if (!ids.length) throw new RestockError("Select cards first.");
  return db.$transaction(async (tx) => {
    await lockPack(tx, packId);
    const pack = (await tx.sitePack.findUnique({ where: { id: packId } }))!;
    const restock = await stagedRestock(tx, packId);
    const where: Prisma.SiteCopyWhereInput =
      mode === "add" ? { status: "DRAFT", ownerId: null, restockId: null } : { status: "POOLED", packId, ownerId: null, restockId: null };
    let staged = 0;
    const blocked: { id: string; reason: string }[] = [];
    // Pool rules (Trevor, Nov 25): eligibility, value range and mix caps, checked against the pool as it will be
    // after this restock (current pool − staged removals + staged additions).
    let mix: Record<string, number> | null = null;
    let mixTotal = 0;
    const cands = mode === "add" ? await tx.siteCopy.findMany({ where: { id: { in: ids } } }) : [];
    const candValue = new Map((await retailOf(tx, cands)).map((v, i) => [cands[i].id, v]));
    if (mode === "add" && hasCaps(pack)) {
      const after = await tx.siteCopy.findMany({
        // (restockId is nullable: NOT alone would drop the unstaged NULL rows.)
        where: { OR: [{ packId, status: "POOLED", restockId: null }, { packId, status: "POOLED", restockId: { not: restock.id } }, { restockId: restock.id, status: "DRAFT" }] },
        select: { language: true, era: true, setName: true },
      });
      mix = typeCounts(after);
      mixTotal = after.length;
    }
    for (const id of ids) {
      if (mode === "add") {
        const c = cands.find((x) => x.id === id);
        if (c) {
          const why = ruleBreak(pack, c, candValue.get(id) ?? null);
          if (why) {
            blocked.push({ id, reason: why });
            continue;
          }
          if (mix) {
            const next = addType(mix, c);
            const cap = capBreak(pack, next, mixTotal + 1);
            if (cap) {
              blocked.push({ id, reason: cap });
              continue;
            }
          }
        }
      }
      // Conditional update: two staff staging the same copy at once can't both win.
      const n = await tx.siteCopy.updateMany({ where: { id, ...where }, data: { restockId: restock.id, autoRestock: false } });
      if (!n.count) continue;
      staged++;
      if (mix) {
        const c = cands.find((x) => x.id === id)!;
        mix = addType(mix, c);
        mixTotal++;
      }
      await tx.siteCopyEvent.create({
        data: { copyId: id, fromStatus: mode === "add" ? "DRAFT" : "POOLED", toStatus: mode === "add" ? "DRAFT" : "POOLED", actor, reason: `staged to ${mode === "add" ? "add to" : "remove from"} ${packId} pool` },
      });
    }
    return { restockId: restock.id, staged, skipped: ids.length - staged, moved: staged, blocked: blocked.slice(0, 50) };
  });
}

/** Take copies out of whatever restock they're staged in. */
export async function unstageRestock(db: PrismaClient, actor: string, copyIds: unknown) {
  const ids = cleanIds(copyIds);
  if (!ids.length) throw new RestockError("Select cards first.");
  return db.$transaction(async (tx) => {
    const rows = await tx.siteCopy.findMany({ where: { id: { in: ids }, restockId: { not: null } }, select: { id: true, status: true, restockId: true } });
    const restocks = await tx.siteRestock.findMany({ where: { id: { in: rows.map((r) => r.restockId!) }, status: "STAGED" }, select: { id: true, packId: true } });
    const open = new Map(restocks.map((r) => [r.id, r.packId]));
    let unstaged = 0;
    for (const r of rows) {
      if (!open.has(r.restockId!)) continue;
      const n = await tx.siteCopy.updateMany({ where: { id: r.id, restockId: r.restockId }, data: { restockId: null } });
      if (!n.count) continue;
      unstaged++;
      await tx.siteCopyEvent.create({ data: { copyId: r.id, fromStatus: r.status, toStatus: r.status, actor, reason: `unstaged from ${open.get(r.restockId!)} restock` } });
    }
    return { unstaged, skipped: ids.length - unstaged };
  });
}

/**
 * Apply adds/removes to a pack pool and save the next version. Caller holds the pack lock and has
 * recorded the baseline. Copies that changed state since staging are released and skipped.
 */
export async function applyRestock(
  tx: Tx,
  pack: { id: string; tierRules: unknown; cardsPerPack: number; priceBits: number },
  prev: { version: number | null },
  staged: SiteCopy[],
  restockId: string | null,
  meta: { actor: string; note: string | null; auto: boolean },
) {
  const packId = pack.id;
  const version = prev.version! + 1;
  const added: SiteCopy[] = [];
  const removed: string[] = [];
  for (const c of staged) {
    const lock = restockId ? { restockId } : { restockId: null };
    if (c.status === "DRAFT" && c.ownerId === null) {
      const n = await tx.siteCopy.updateMany({ where: { id: c.id, status: "DRAFT", ownerId: null, ...lock }, data: { status: "POOLED", packId, restockId: null, autoRestock: false } });
      if (!n.count) continue;
      added.push(c);
      await tx.siteCopyEvent.create({ data: { copyId: c.id, fromStatus: "DRAFT", toStatus: "POOLED", actor: meta.actor, reason: `restock v${version}: added to ${packId} pool` } });
    } else if (c.status === "POOLED" && c.packId === packId) {
      const n = await tx.siteCopy.updateMany({ where: { id: c.id, status: "POOLED", packId, ...lock }, data: { status: "DRAFT", packId: null, restockId: null } });
      if (!n.count) continue;
      removed.push(c.id);
      await tx.siteCopyEvent.create({ data: { copyId: c.id, fromStatus: "POOLED", toStatus: "DRAFT", actor: meta.actor, reason: `restock v${version}: removed from ${packId} pool` } });
    } else if (restockId) {
      await tx.siteCopy.updateMany({ where: { id: c.id, restockId }, data: { restockId: null } });
    }
  }
  if (!added.length && !removed.length) return null;
  const pool = await tx.siteCopy.findMany({ where: { packId, status: "POOLED" }, select: { id: true, printingKey: true, condition: true, retailBits: true } });
  const ids = pool.map((c) => c.id).sort(cmp);
  // Auto tiers (Trevor, Nov 25): new cutoffs from the pool as published, saved with this version.
  const tiered = await recomputeTiers(tx, packId);
  const rules = tiered ? tiered.rules : tierRules(pack.tierRules);
  const data = {
    status: "LIVE",
    version,
    addIds: added.map((c) => c.id).sort(cmp),
    removeIds: removed.sort(cmp),
    poolIds: ids,
    poolHash: poolHashOf(ids),
    poolSize: ids.length,
    tiers: await tierCounts(tx, added, rules),
    tierRules: rules,
    note: meta.note,
    actor: meta.actor,
    auto: meta.auto,
    evPct: evPct(await retailSum(tx, pool), ids.length, pack),
    liveAt: new Date(),
  };
  return restockId ? tx.siteRestock.update({ where: { id: restockId }, data }) : tx.siteRestock.create({ data: { packId, ...data } });
}

/** Publish the pack's staged restock now: apply it and save the next pool version. */
export async function publishRestock(db: PrismaClient, actor: string, packId: string, note?: unknown) {
  const pack = await packOrThrow(db, packId);
  const text = typeof note === "string" ? note.trim().slice(0, 200) || null : null;
  return db.$transaction(
    async (tx) => {
      await lockPack(tx, packId);
      const prev = await ensureBaseline(tx, packId, actor);
      const restock = await tx.siteRestock.findFirst({ where: { packId, status: "STAGED" } });
      const staged = restock ? await tx.siteCopy.findMany({ where: { restockId: restock.id } }) : [];
      if (!restock || !staged.length) throw new RestockError("Stage cards for this restock first.");
      const out = await applyRestock(tx, pack, prev, staged, restock.id, { actor, note: text, auto: false });
      if (!out) throw new RestockError("None of the staged cards can be applied. Review the restock.");
      return out;
    },
    { timeout: 20_000 },
  );
}

// ---------- EV (internal only) and automatic buyback restocks ----------

/** Poke-Collect retail of each copy (the copy's own retail if set, else the printing+condition price). */
async function retailOf(db: Db, copies: Pick<SiteCopy, "printingKey" | "condition" | "retailBits">[]) {
  const keys = [...new Set(copies.map((c) => priceKey(c.printingKey, c.condition)))];
  const prices = keys.length ? await db.sitePrice.findMany({ where: { printingKey: { in: keys } } }) : [];
  const byKey = new Map(prices.map((p) => [p.printingKey, p.retailBits]));
  return copies.map((c) => c.retailBits ?? byKey.get(priceKey(c.printingKey, c.condition)) ?? null);
}
async function retailSum(db: Db, copies: Pick<SiteCopy, "printingKey" | "condition" | "retailBits">[]) {
  return (await retailOf(db, copies)).reduce<number>((a, v) => a + (v ?? 0), 0);
}

/**
 * EV % = pool's Poke-Collect retail ÷ (packs left × pack price) × 100, with packs left counted exactly
 * (cards ÷ cards per pack). 110 means the remaining pool is worth 110% of what its packs sell for.
 */
export function evPct(retailBits: number, cards: number, pack: { cardsPerPack: number; priceBits: number }) {
  if (!cards || !pack.priceBits) return null;
  return Math.round(((retailBits * pack.cardsPerPack) / (cards * pack.priceBits)) * 10_000) / 100;
}

// Wizards of the Coast era (1999–2003) sets. Card Broker can send `era` to override.
const VINTAGE_SETS = /^(base set|base set 2|jungle|fossil|team rocket|gym heroes|gym challenge|neo |legendary collection|expedition|aquapolis|skyridge|southern islands|wizards black star|wotc)/i;
export function eraOf(c: Pick<SiteCopy, "era" | "setName">) {
  if (c.era === "Modern" || c.era === "Vintage") return c.era;
  return VINTAGE_SETS.test(c.setName.trim()) ? "Vintage" : "Modern";
}
const list = (raw: unknown) => (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()) : null);
export function eligible(pack: { languages: unknown; eras: unknown }, c: Pick<SiteCopy, "language" | "era" | "setName">) {
  const langs = list(pack.languages);
  const eras = list(pack.eras);
  if (langs && !langs.includes(c.language.toLowerCase())) return false;
  if (eras && !eras.includes(eraOf(c).toLowerCase())) return false;
  return true;
}

export type PoolState = { pack: Awaited<ReturnType<PrismaClient["sitePack"]["findMany"]>>[number]; cards: number; retail: number; top: number; topTier: string; mix?: Mix };

const topTierOf = (rules: TierRule[]) => rules[rules.length - 1].name;

async function poolStates(db: Db) {
  const packs = await db.sitePack.findMany({ orderBy: { sortOrder: "asc" } });
  const pooled = await db.siteCopy.findMany({
    where: { status: "POOLED", packId: { not: null } },
    select: { packId: true, printingKey: true, condition: true, retailBits: true, language: true, era: true, setName: true },
  });
  const values = await retailOf(db, pooled);
  const states = new Map<string, PoolState>();
  for (const p of packs) states.set(p.id, { pack: p, cards: 0, retail: 0, top: 0, topTier: topTierOf(tierRules(p.tierRules)), mix: typeCounts([]) });
  pooled.forEach((c, i) => {
    const st = states.get(c.packId!);
    if (!st) return;
    st.cards++;
    st.retail += values[i] ?? 0;
    st.mix = addType(st.mix!, c);
    if (tierFor(values[i], tierRules(st.pack.tierRules)) === st.topTier) st.top++;
  });
  return states;
}

/**
 * Where one card should go: the eligible pack with a target whose EV it moves closest to target (or keeps in
 * band), favouring packs short of their top-tier minimum, then the pack with fewer packs left. null = none.
 */
export function routeCard(value: number, card: Pick<SiteCopy, "language" | "era" | "setName">, states: Iterable<PoolState>) {
  let best: { st: PoolState; score: number } | null = null;
  for (const st of states) {
    const p = st.pack;
    if (isPrizePool(p) || p.targetEvPct == null || ruleBreak(p, card, value)) continue;
    if (st.mix && capBreak(p, addType(st.mix, card), st.cards + 1)) continue;
    const before = evPct(st.retail, st.cards, p);
    const after = evPct(st.retail + value, st.cards + 1, p)!;
    const { lo, hi, aim } = evBand(p)!;
    const gapBefore = before == null ? Infinity : Math.abs(before - aim);
    const gapAfter = Math.abs(after - aim);
    const inBand = after >= lo && after <= hi;
    if (!inBand && !(gapAfter < gapBefore)) continue; // would push the pool (further) out of band
    const isTop = tierFor(value, tierRules(p.tierRules)) === st.topTier;
    const shortTop = p.minTopPer100 != null && st.top < Math.ceil(((st.cards + 1) * p.minTopPer100) / 100);
    const improvement = Number.isFinite(gapBefore) ? gapBefore - gapAfter : 100;
    const score = (isTop && shortTop ? 1000 : 0) + improvement * 10 - st.cards / Math.max(p.cardsPerPack, 1) / 1000;
    if (!best || score > best.score) best = { st, score };
  }
  return best?.st ?? null;
}

/**
 * Trim one pack's planned batch so the pool ends inside its EV band, or (if it already had cards) at least
 * closer to target than before. Too high: drop the most valuable planned card; too low: drop the cheapest.
 */
export function trimToBand<T extends { v: number }>(
  pack: { targetEvPct: number | null; evBandPct: number; cardsPerPack: number; priceBits: number },
  base: { cards: number; retail: number },
  planned: T[],
): T[] {
  const band = evBand(pack);
  if (!band) return [];
  const { lo, hi, aim: target } = band;
  const before = evPct(base.retail, base.cards, pack);
  const gapBefore = before == null ? Infinity : Math.abs(before - target);
  const kept = [...planned].sort((a, b) => b.v - a.v);
  while (kept.length) {
    const ev = evPct(base.retail + kept.reduce((a, x) => a + x.v, 0), base.cards + kept.length, pack)!;
    if ((ev >= lo && ev <= hi) || (base.cards > 0 && Math.abs(ev - target) < gapBefore)) break;
    if (ev > hi) kept.shift();
    else kept.pop();
  }
  return kept;
}

// ---------- Buyback-loop margin (Trevor, Nov 27 2026) ----------
// A pulled card can be sold back for 80% of its Poke-Collect retail, in Cardbits that get spent on more packs.
// So for every 100 Cardbits a pack brings in, up to 0.8 × EV comes back as buyback Cardbits. Loop margin =
// 100 − 0.8 × EV. Rule: at least 10%, target 10–15%, which means EV from 106.25% to 112.5%.
// - No pack's EV band may reach past 112.5% (the ceiling), whatever its Target EV ± band says.
// - The hourly auto-restock fixes a pack outside its band by ADDING Drafts only (lower-value Drafts if EV is
//   too high, higher-value if too low), aiming at the target. Removing cards is staff-only (Reshuffle).
export const LOOP_BUYBACK_SHARE = 0.8;
export const LOOP_MARGIN_MIN = 10;
export const LOOP_MARGIN_TARGET_MAX = 15;
/** Highest EV that still keeps the minimum loop margin: 112.5. */
export const EV_CEILING = (100 - LOOP_MARGIN_MIN) / LOOP_BUYBACK_SHARE;
/** EV below this gives a loop margin above the 15% target (allowed; customers just get less value): 106.25. */
export const EV_LOOP_FLOOR = (100 - LOOP_MARGIN_TARGET_MAX) / LOOP_BUYBACK_SHARE;
/** Buyback-loop margin % for an EV % (null when there's no EV). */
export const loopMarginPct = (ev: number | null) => (ev == null ? null : Math.round((100 - LOOP_BUYBACK_SHARE * ev) * 100) / 100);

/** A pack's working EV band: Target EV ± band, with the top cut at the loop ceiling. aim = where fixes head. */
export function evBand(pack: { targetEvPct: number | null; evBandPct: number }) {
  if (pack.targetEvPct == null) return null;
  const hi = Math.min(pack.targetEvPct + pack.evBandPct, EV_CEILING);
  const lo = Math.min(pack.targetEvPct - pack.evBandPct, hi);
  return { lo, hi, aim: Math.min(pack.targetEvPct, hi), capped: pack.targetEvPct + pack.evBandPct > EV_CEILING };
}

export type RebalanceCard = { id: string; v: number; key: string; language: string; era: string | null; setName: string };
type RebalancePack = RulePack & { targetEvPct: number | null; evBandPct: number; cardsPerPack: number; priceBits: number; minTopPer100: number | null; tierRules: unknown };

/**
 * Plan the smallest set of moves that brings a pool's EV into its band and close to its aim (pure; no writes).
 * Each step takes the single move that lands EV closest to the aim: adding an eligible Draft (Pool Rules, mix
 * caps, at most one copy of a printing per pack's worth of cards) or, if `allowRemove`, taking a pooled card out.
 * Adding is always preferred; a removal is used only when no add helps and EV is still outside the band. Never drops the pool below one pack or
 * below its top-tier minimum. Stops once EV is within half a point of the aim, or nothing helps.
 */
export function planRebalance(
  pack: RebalancePack,
  pool: RebalanceCard[],
  drafts: RebalanceCard[],
  opts: { allowRemove: boolean; maxMoves?: number; keep?: Set<string> },
) {
  const band = evBand(pack);
  const before = evPct(pool.reduce((a, c) => a + c.v, 0), pool.length, pack);
  const out = { band, before, after: before, adds: [] as RebalanceCard[], removes: [] as RebalanceCard[], inBand: false };
  if (!band || isPrizePool(pack)) return out;
  const rules = tierRules(pack.tierRules);
  const topTier = topTierOf(rules);
  const isTop = (c: RebalanceCard) => tierFor(c.v, rules) === topTier;
  let cards = pool.length;
  let retail = pool.reduce((a, c) => a + c.v, 0);
  let top = pool.filter(isTop).length;
  let mix = typeCounts(pool);
  const perKey = new Map<string, number>();
  for (const c of pool) perKey.set(c.key, (perKey.get(c.key) ?? 0) + 1);
  const inPool = new Map(pool.map((c) => [c.id, c]));
  const free = drafts.filter((c) => c.v > 0 && !ruleBreak(pack, c, c.v));
  const used = new Set<string>();
  const gapOf = (r: number, n: number) => {
    const ev = evPct(r, n, pack);
    return ev == null ? Infinity : Math.abs(ev - band.aim);
  };
  const max = opts.maxMoves ?? 500;
  for (let step = 0; step < max; step++) {
    const ev = evPct(retail, cards, pack);
    const gap = ev == null ? Infinity : Math.abs(ev - band.aim);
    if (gap <= 0.5) break;
    // Best add.
    let add: RebalanceCard | null = null;
    let addGap = gap;
    const keyCap = Math.max(1, Math.floor((cards + 1) / Math.max(pack.cardsPerPack, 1)));
    for (const c of free) {
      if (used.has(c.id)) continue;
      if (pack.cardsPerPack > 1 && (perKey.get(c.key) ?? 0) >= keyCap) continue;
      const g = gapOf(retail + c.v, cards + 1);
      if (g < addGap - 1e-9 && !(mix && capBreak(pack, addType(mix, c), cards + 1))) {
        add = c;
        addGap = g;
      }
    }
    if (add) {
      used.add(add.id);
      out.adds.push(add);
      cards++;
      retail += add.v;
      mix = addType(mix, add);
      perKey.set(add.key, (perKey.get(add.key) ?? 0) + 1);
      if (isTop(add)) top++;
      continue;
    }
    // Removing is a last resort, only to get back inside the band (never just to fine-tune).
    if (!opts.allowRemove || (ev != null && ev >= band.lo && ev <= band.hi) || cards - 1 < Math.max(pack.cardsPerPack, 1)) break;
    let rem: RebalanceCard | null = null;
    let remGap = gap;
    for (const c of inPool.values()) {
      if (opts.keep?.has(c.id)) continue;
      const t = isTop(c);
      if (t && pack.minTopPer100 != null && top - 1 < Math.ceil(((cards - 1) * pack.minTopPer100) / 100)) continue;
      if (t && top - 1 < 1) continue; // keep at least one top-tier card
      const g = gapOf(retail - c.v, cards - 1);
      if (g < remGap - 1e-9) {
        rem = c;
        remGap = g;
      }
    }
    if (!rem) break;
    inPool.delete(rem.id);
    out.removes.push(rem);
    cards--;
    retail -= rem.v;
    const m = { ...mix };
    for (const t of typesOf(rem)) m[t] = Math.max(0, (m[t] ?? 0) - 1);
    mix = m;
    perKey.set(rem.key, Math.max(0, (perKey.get(rem.key) ?? 0) - 1));
    if (isTop(rem)) top--;
  }
  out.after = evPct(retail, cards, pack);
  out.inBand = out.after != null && out.after >= band.lo && out.after <= band.hi;
  return out;
}

const rebalanceCard = (c: Pick<SiteCopy, "id" | "printingKey" | "language" | "era" | "setName">, v: number | null): RebalanceCard => ({
  id: c.id,
  v: v ?? 0,
  key: c.printingKey,
  language: c.language,
  era: c.era,
  setName: c.setName,
});

const AUTO_KEY = "cardbit-site:auto-restock";
/** A newly listed Draft card waits this long before the hourly auto-restock may pool it, so staff can Make Active first. */
export const DRAFT_HOLD_MIN = 120;

/**
 * Hourly automatic restock (Trevor, Nov 25).
 * - Buybacks: every sold-back Draft card still marked for auto restock may go to any pack with a Target EV.
 * - Listed Drafts: any other non-demo Draft card listed at least DRAFT_HOLD_MIN minutes ago may go only to
 *   packs with "Auto-Fill From Drafts" switched on (SitePack.autoDrafts, off by default).
 * Each card goes to the one pool it fits best (pool rules, mix caps, EV band, top-tier need); then one
 * logged restock is published per pack touched. Cards no pool can take stay in Draft.
 */
export async function runAutoRestock(db: PrismaClient, opts: { force?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  // Atomic claim: only one instance per hour gets a row back.
  const since = new Date(now.getTime() - (opts.force ? 0 : 59 * 60_000));
  const claimed = await db.$queryRaw<{ key: string }[]>`
    INSERT INTO "AppValue" ("key", "value", "updatedAt") VALUES (${AUTO_KEY}, ${now.toISOString()}, ${now})
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = EXCLUDED."updatedAt"
    WHERE "AppValue"."updatedAt" <= ${since}
    RETURNING "key"`;
  const none = { routed: 0, held: 0, drafts: 0, versions: [] as { packId: string; version: number }[] };
  if (!claimed.length) return { ran: false, ...none, retiered: 0 };
  const retiered = await dailyTiers(db, now);
  const draftPacks = await db.sitePack.count({ where: { autoDrafts: true, OR: [{ targetEvPct: { not: null } }, { kind: { not: "pack" } }] } });
  const listedBefore = new Date(now.getTime() - DRAFT_HOLD_MIN * 60_000);
  const free = { status: "DRAFT", ownerId: null, restockId: null } as const;
  const waiting = await db.siteCopy.findMany({
    where: draftPacks
      ? { ...free, OR: [{ autoRestock: true }, { autoRestock: false, demo: false, createdAt: { lte: listedBefore } }] }
      : { ...free, autoRestock: true },
    orderBy: { updatedAt: "asc" },
    take: 3000,
  });
  if (!waiting.length) return { ran: true, ...none, retiered };
  const values = await retailOf(db, waiting);
  const states = await poolStates(db);
  const base = new Map([...states].map(([id, st]) => [id, { cards: st.cards, retail: st.retail }]));
  const valueOf = new Map(waiting.map((c, i) => [c.id, values[i] ?? 0]));
  const draftStates = [...states.values()].filter((st) => st.pack.autoDrafts);
  const plan = new Map<string, SiteCopy[]>();
  // Highest value first, so scarce chase cards go where they're needed most.
  const order = waiting.map((c, i) => ({ c, v: values[i] })).sort((a, b) => (b.v ?? 0) - (a.v ?? 0));
  let held = 0;
  for (const { c, v } of order) {
    const st = v && v > 0 ? routeCard(v, c, c.autoRestock ? states.values() : draftStates) : null;
    if (!st) {
      if (c.autoRestock) held++; // listed Drafts no pool needs are not "held": they're ordinary Drafts
      continue;
    }
    st.cards++;
    st.retail += v!;
    if (st.mix) st.mix = addType(st.mix, c);
    if (tierFor(v!, tierRules(st.pack.tierRules)) === st.topTier) st.top++;
    plan.set(st.pack.id, [...(plan.get(st.pack.id) ?? []), c]);
  }
  // Each pack's batch must leave its pool inside the EV band (or, for a pool that already had cards, closer
  // to target). Card-by-card routing alone can seed an empty pool with one big card and then pile in
  // everything that pulls EV back down without ever reaching the band; trim those batches instead.
  for (const [packId, cards] of plan) {
    const st = states.get(packId)!;
    // Buybacks keep the routing they had before; only the listed-Draft part of a batch is trimmed.
    const buybacks = cards.filter((c) => c.autoRestock);
    const b0 = base.get(packId)!;
    const withBuybacks = { cards: b0.cards + buybacks.length, retail: b0.retail + buybacks.reduce((a, c) => a + valueOf.get(c.id)!, 0) };
    const listed = cards.filter((c) => !c.autoRestock).map((c) => ({ c, v: valueOf.get(c.id)! }));
    const kept = [...buybacks, ...(listed.length ? trimToBand(st.pack, withBuybacks, listed).map((x) => x.c) : [])];
    if (kept.length) plan.set(packId, kept);
    else plan.delete(packId);
  }
  // Buyback-loop fix (Trevor, Nov 27 2026): a pack (Auto-Fill on) still outside its EV band after routing gets
  // more Drafts, ADD-ONLY: lower-value ones if EV is too high, higher-value ones if too low, aiming at its target
  // (never past the 112.5% ceiling). Removing cards stays a staff Reshuffle. Same 2-hour hold as above.
  const fixed = await addOnlyFix(db, states, plan, waiting, valueOf);
  // Prize pools with Auto-Fill on (Daily Spins, Spark Shop): top up each Fill Rule range from whatever no pack took,
  // oldest listing first. Packs always get first pick.
  const taken = new Set([...plan.values()].flat().map((c) => c.id));
  const prizePools = [...states.values()].filter((st) => isPrizePool(st.pack) && st.pack.autoDrafts && fillTargets(st.pack.fillTargets).length);
  if (prizePools.length) {
    const pooledNow = await db.siteCopy.findMany({ where: { status: "POOLED", packId: { in: prizePools.map((st) => st.pack.id) } }, select: { packId: true, printingKey: true, condition: true, retailBits: true } });
    const pooledVals = await retailOf(db, pooledNow);
    const byAge = [...waiting].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const st of prizePools) {
      const mine = pooledNow.map((c, i) => ({ c, v: pooledVals[i] })).filter((x) => x.c.packId === st.pack.id);
      for (const t of fillTargets(st.pack.fillTargets)) {
        let need = t.count - mine.filter((x) => x.v != null && inRange(x.v, t)).length;
        for (const c of byAge) {
          if (need <= 0) break;
          const v = valueOf.get(c.id) ?? 0;
          if (taken.has(c.id) || !v || !inRange(v, t) || ruleBreak(st.pack, c, v)) continue;
          if (!c.autoRestock && c.demo) continue;
          if (st.mix && capBreak(st.pack, addType(st.mix, c), st.cards + 1)) continue;
          taken.add(c.id);
          need--;
          st.cards++;
          if (st.mix) st.mix = addType(st.mix, c);
          mine.push({ c: { packId: st.pack.id, printingKey: c.printingKey, condition: c.condition, retailBits: c.retailBits }, v });
          plan.set(st.pack.id, [...(plan.get(st.pack.id) ?? []), c]);
          if (c.autoRestock) held = Math.max(0, held - 1);
        }
      }
    }
  }
  const versions: { packId: string; version: number }[] = [];
  let routed = 0,
    drafts = 0;
  for (const [packId, cards] of plan) {
    const st = states.get(packId)!;
    const out = await db.$transaction(
      async (tx) => {
        await lockPack(tx, packId);
        const prev = await ensureBaseline(tx, packId, "auto-restock");
        // Only cards still free and unchanged (staff may have listed, staged, made Active or deleted one meanwhile).
        const fresh = await tx.siteCopy.findMany({
          where: {
            ...free,
            OR: [
              { id: { in: cards.filter((c) => c.autoRestock).map((c) => c.id) }, autoRestock: true },
              { id: { in: cards.filter((c) => !c.autoRestock).map((c) => c.id) }, autoRestock: false, demo: false },
            ],
          },
        });
        if (!fresh.length) return null;
        const fromDrafts = fresh.filter((c) => !c.autoRestock).length;
        const note = !fromDrafts ? "Buyback Restock" : fromDrafts === fresh.length ? "Auto Restock" : "Auto Restock (Drafts + Buybacks)";
        const v = await applyRestock(tx, st.pack, prev, fresh, null, { actor: "auto-restock", note, auto: true });
        if (!v) return null;
        const added = new Set(v.addIds as string[]);
        return { v, fromDrafts: fresh.filter((c) => !c.autoRestock && added.has(c.id)).length };
      },
      { timeout: 20_000 },
    );
    if (out) {
      versions.push({ packId, version: out.v.version! });
      routed += (out.v.addIds as string[]).length;
      drafts += out.fromDrafts;
    }
  }
  return { ran: true, routed, held, drafts, versions, retiered, loopFixed: fixed };
}

/** Hourly add-only EV fix; adds its picks to `plan` and returns how many cards it added per pack. */
async function addOnlyFix(db: Db, states: Map<string, PoolState>, plan: Map<string, SiteCopy[]>, waiting: SiteCopy[], valueOf: Map<string, number>) {
  const packs = [...states.values()].filter((st) => !isPrizePool(st.pack) && st.pack.autoDrafts && evBand(st.pack));
  if (!packs.length) return [];
  const pooled = await db.siteCopy.findMany({
    where: { status: "POOLED", packId: { in: packs.map((st) => st.pack.id) } },
    select: { id: true, packId: true, printingKey: true, condition: true, retailBits: true, language: true, era: true, setName: true },
  });
  const vals = await retailOf(db, pooled);
  const out: { packId: string; added: number; evBefore: number | null; evAfter: number | null; inBand: boolean }[] = [];
  for (const st of packs) {
    const planned = plan.get(st.pack.id) ?? [];
    const pool = [
      ...pooled.flatMap((c, i) => (c.packId === st.pack.id ? [rebalanceCard(c, vals[i])] : [])),
      ...planned.map((c) => rebalanceCard(c, valueOf.get(c.id) ?? 0)),
    ];
    const band = evBand(st.pack)!;
    const ev = evPct(pool.reduce((a, c) => a + c.v, 0), pool.length, st.pack);
    if (ev == null || (ev >= band.lo && ev <= band.hi)) continue;
    const taken = new Set([...plan.values()].flat().map((c) => c.id));
    const free = waiting.filter((c) => !taken.has(c.id) && (c.autoRestock || !c.demo));
    const r = planRebalance(st.pack, pool, free.map((c) => rebalanceCard(c, valueOf.get(c.id) ?? 0)), { allowRemove: false });
    out.push({ packId: st.pack.id, added: r.adds.length, evBefore: ev, evAfter: r.after, inBand: r.inBand });
    if (!r.adds.length) continue;
    const byId = new Map(free.map((c) => [c.id, c]));
    plan.set(st.pack.id, [...planned, ...r.adds.map((a) => byId.get(a.id)!)]);
  }
  return out;
}

// ---------- Auto-pick packs for Drafts (Trevor, Nov 27 2026) ----------

/**
 * Pool state per pack as it will be after its open (staged) restock publishes: live pool minus staged removals
 * plus staged additions. Auto-pick routes on top of this so a second press never overfills a pack.
 */
async function poolStatesAfterStaged(db: Db) {
  const states = await poolStates(db);
  const open = await db.siteRestock.findMany({ where: { status: "STAGED" }, select: { id: true, packId: true } });
  if (!open.length) return states;
  const packOf = new Map(open.map((r) => [r.id, r.packId]));
  const staged = await db.siteCopy.findMany({
    where: { restockId: { in: open.map((r) => r.id) } },
    select: { status: true, packId: true, restockId: true, printingKey: true, condition: true, retailBits: true, language: true, era: true, setName: true },
  });
  const values = await retailOf(db, staged);
  staged.forEach((c, i) => {
    const st = states.get(packOf.get(c.restockId!)!);
    if (!st) return;
    const v = values[i] ?? 0;
    const isTop = tierFor(values[i], tierRules(st.pack.tierRules)) === st.topTier;
    if (c.status === "DRAFT") {
      st.cards++;
      st.retail += v;
      st.mix = addType(st.mix!, c);
      if (isTop) st.top++;
    } else if (c.status === "POOLED" && c.packId === st.pack.id) {
      st.cards--;
      st.retail -= v;
      const m = { ...st.mix! };
      for (const t of typesOf(c)) m[t] = Math.max(0, (m[t] ?? 0) - 1);
      st.mix = m;
      if (isTop) st.top = Math.max(0, st.top - 1);
    }
  });
  return states;
}

/**
 * Staff "Auto-Pick Packs": choose the pack for Draft cards with the same routing the hourly Auto-Fill uses
 * (Pool Rules, mix caps, EV band, top-tier need, one pool per card, batch trimmed to the band), then STAGE
 * them into each pack's open restock. Nothing goes live until staff press Publish. Unlike the hourly run there
 * is no 2-hour wait and the Auto-Fill switch doesn't matter: staff chose these cards. Packs need a Target EV.
 * copyIds: the selected Draft cards, or "all" = every unowned, unstaged, non-demo Draft card.
 */
export async function autoStageDrafts(db: PrismaClient, actor: string, copyIds: unknown) {
  const all = copyIds === "all";
  const ids = all ? null : cleanIds(copyIds);
  if (ids && !ids.length) throw new RestockError("Select cards first.");
  const free = { status: "DRAFT", ownerId: null, restockId: null } as const;
  const cands = await db.siteCopy.findMany({
    where: ids ? { ...free, id: { in: ids } } : { ...free, demo: false },
    orderBy: { createdAt: "asc" },
    take: 3000,
  });
  const states = await poolStatesAfterStaged(db);
  const packs = [...states.values()].filter((st) => !isPrizePool(st.pack) && st.pack.targetEvPct != null);
  if (!packs.length) throw new RestockError("No pack has a Target EV yet. Set one in Pools → EV & Pool Rules first.");
  const values = await retailOf(db, cands);
  const valueOf = new Map(cands.map((c, i) => [c.id, values[i] ?? 0]));
  const base = new Map(packs.map((st) => [st.pack.id, { cards: st.cards, retail: st.retail }]));
  const plan = new Map<string, SiteCopy[]>();
  const noPrice = cands.filter((c) => !(valueOf.get(c.id)! > 0)).length;
  // Highest value first, so scarce chase cards go where they're needed most (same as the hourly run). Then each
  // pack's batch is trimmed to its EV band. A card a pack's trim dropped gets another try at the other packs
  // (the hourly run just leaves it in Drafts), so one big card in an empty pool doesn't strand the rest.
  const banned = new Map<string, Set<string>>();
  let todo = cands.filter((c) => valueOf.get(c.id)! > 0).sort((a, b) => valueOf.get(b.id)! - valueOf.get(a.id)!);
  for (let pass = 0; pass < 6 && todo.length; pass++) {
    const snap = new Map(packs.map((st) => [st.pack.id, { cards: st.cards, retail: st.retail, mix: st.mix, top: st.top }]));
    const round = new Map<string, SiteCopy[]>();
    for (const c of todo) {
      const v = valueOf.get(c.id)!;
      const st = routeCard(v, c, packs.filter((x) => !banned.get(c.id)?.has(x.pack.id)));
      if (!st) continue;
      st.cards++;
      st.retail += v;
      if (st.mix) st.mix = addType(st.mix, c);
      if (tierFor(v, tierRules(st.pack.tierRules)) === st.topTier) st.top++;
      round.set(st.pack.id, [...(round.get(st.pack.id) ?? []), c]);
    }
    const retry: SiteCopy[] = [];
    for (const st of packs) {
      const s0 = snap.get(st.pack.id)!;
      Object.assign(st, s0);
      const cards = round.get(st.pack.id);
      if (!cards) continue;
      const kept = trimToBand(st.pack, s0, cards.map((c) => ({ c, v: valueOf.get(c.id)! })));
      const keptIds = new Set(kept.map((x) => x.c.id));
      for (const c of cards) {
        if (keptIds.has(c.id)) continue;
        banned.set(c.id, (banned.get(c.id) ?? new Set()).add(st.pack.id));
        retry.push(c);
      }
      for (const { c, v } of kept) {
        st.cards++;
        st.retail += v;
        if (st.mix) st.mix = addType(st.mix, c);
        if (tierFor(v, tierRules(st.pack.tierRules)) === st.topTier) st.top++;
      }
      if (kept.length) plan.set(st.pack.id, [...(plan.get(st.pack.id) ?? []), ...kept.map((x) => x.c)]);
    }
    todo = retry.sort((a, b) => valueOf.get(b.id)! - valueOf.get(a.id)!);
  }
  const results: { packId: string; title: string; staged: number; evAfterPct: number | null }[] = [];
  const blocked: { id: string; reason: string }[] = [];
  let staged = 0;
  for (const [packId, cards] of plan) {
    const st = states.get(packId)!;
    const b0 = base.get(packId)!;
    const kept = cards.map((c) => ({ c, v: valueOf.get(c.id)! }));
    // stageRestock re-checks Pool Rules and caps under the pack lock and skips anything taken meanwhile.
    const r = await stageRestock(db, actor, packId, kept.map((x) => x.c.id), "add");
    blocked.push(...r.blocked);
    if (!r.staged) continue;
    staged += r.staged;
    const blockedIds = new Set(r.blocked.map((x) => x.id));
    const added = kept.filter((x) => !blockedIds.has(x.c.id));
    results.push({
      packId,
      title: st.pack.title,
      staged: r.staged,
      evAfterPct: evPct(b0.retail + added.reduce((a, x) => a + x.v, 0), b0.cards + added.length, st.pack),
    });
  }
  return { considered: cands.length, staged, left: cands.length - staged, noPrice, packs: results, blocked: blocked.slice(0, 20) };
}

// ---------- Reshuffle (Trevor, Nov 27 2026) ----------

/**
 * Staff "Reshuffle": bring one pack's EV into its band (and buyback-loop margin) by adding Draft cards and, only
 * when adding can't do it, taking pooled cards out (they go back to Draft). Tiers re-rank on the new pool. With
 * apply=false it only previews. With apply=true it does it in ONE transaction under the pack lock that openings
 * take, together with anything already staged for this pack, and publishes it as a new pool version (new list
 * and hash). Pulled, vaulted and shipped cards are never touched, and past openings keep the version they drew.
 */
export async function reshufflePack(db: PrismaClient, actor: string, packId: string, apply: boolean) {
  const pack = await packOrThrow(db, packId);
  if (isPrizePool(pack)) throw new RestockError("Prize pools have no EV. Use Fill Rules instead.");
  if (pack.targetEvPct == null) throw new RestockError("Set a Target EV for this pack first.");
  const run = async (tx: Db) => {
    const restock = await tx.siteRestock.findFirst({ where: { packId, status: "STAGED" } });
    // The pool as it will be after anything already staged: live pool minus staged removals plus staged adds.
    const pool = await tx.siteCopy.findMany({
      where: {
        OR: [
          { packId, status: "POOLED", restockId: null },
          ...(restock ? [{ restockId: restock.id, status: "DRAFT" as const }] : []),
        ],
      },
    });
    const drafts = await tx.siteCopy.findMany({ where: { status: "DRAFT", ownerId: null, restockId: null, demo: false }, orderBy: { createdAt: "asc" }, take: 3000 });
    const [poolVals, draftVals] = await Promise.all([retailOf(tx, pool), retailOf(tx, drafts)]);
    const plan = planRebalance(
      pack,
      pool.map((c, i) => rebalanceCard(c, poolVals[i])),
      drafts.map((c, i) => rebalanceCard(c, draftVals[i])),
      // Cards already staged to add can't be "removed" by the plan; only live pooled cards can.
      { allowRemove: true, keep: new Set(pool.filter((c) => c.status !== "POOLED").map((c) => c.id)) },
    );
    return { restock, pool, drafts, plan };
  };
  const view = (p: Awaited<ReturnType<typeof run>>["plan"], extra: Record<string, unknown> = {}) => ({
    packId,
    title: pack.title,
    band: p.band,
    evBefore: p.before,
    evAfter: p.after,
    marginBefore: loopMarginPct(p.before),
    marginAfter: loopMarginPct(p.after),
    inBand: p.inBand,
    adds: p.adds.map((c) => ({ id: c.id, retailBits: c.v })),
    removes: p.removes.map((c) => ({ id: c.id, retailBits: c.v })),
    ...extra,
  });
  if (!apply) {
    const { plan, drafts, pool } = await run(db);
    const titles = new Map([...drafts, ...pool].map((c) => [c.id, { title: c.title, condition: c.condition, slot: c.slot, pocket: c.pocket }]));
    const v = view(plan);
    return { ...v, adds: v.adds.map((a) => ({ ...a, ...titles.get(a.id) })), removes: v.removes.map((a) => ({ ...a, ...titles.get(a.id) })), applied: false };
  }
  return db.$transaction(
    async (tx) => {
      await lockPack(tx, packId);
      const prev = await ensureBaseline(tx, packId, actor);
      const { plan } = await run(tx);
      if (!plan.adds.length && !plan.removes.length) throw new RestockError(plan.inBand ? "This pack is already on target." : "No Draft card or pooled card would move this pack's EV closer to target.");
      const restock = await stagedRestock(tx, packId);
      // Conditional updates: a card another pack or staff member took meanwhile is just skipped.
      for (const c of plan.adds) await tx.siteCopy.updateMany({ where: { id: c.id, status: "DRAFT", ownerId: null, restockId: null }, data: { restockId: restock.id, autoRestock: false } });
      for (const c of plan.removes) await tx.siteCopy.updateMany({ where: { id: c.id, status: "POOLED", packId, ownerId: null, restockId: null }, data: { restockId: restock.id } });
      const staged = await tx.siteCopy.findMany({ where: { restockId: restock.id } });
      const out = await applyRestock(tx, pack, prev, staged, restock.id, { actor, note: "Reshuffle", auto: false });
      if (!out) throw new RestockError("None of the cards could be applied. Refresh and try again.");
      return view(plan, { applied: true, version: out.version, poolHash: out.poolHash, poolSize: out.poolSize, evAfter: out.evPct, marginAfter: loopMarginPct(out.evPct) });
    },
    { timeout: 30_000 },
  );
}

/** Publish every pack's staged restock now (one new pool version per pack). Prize pools included. */
export async function publishAllStaged(db: PrismaClient, actor: string, note?: unknown) {
  const open = await db.siteRestock.findMany({ where: { status: "STAGED" }, select: { packId: true, id: true } });
  const out: { packId: string; version: number; added: number; removed: number }[] = [];
  const skipped: { packId: string; reason: string }[] = [];
  for (const r of open) {
    if (!(await db.siteCopy.count({ where: { restockId: r.id } }))) continue;
    try {
      const v = await publishRestock(db, actor, r.packId, note);
      out.push({ packId: r.packId, version: v.version!, added: (v.addIds as string[]).length, removed: (v.removeIds as string[]).length });
    } catch (e) {
      if (!(e instanceof RestockError)) throw e;
      skipped.push({ packId: r.packId, reason: e.message });
    }
  }
  return { published: out, skipped };
}

/** Once a day (after price refreshes) re-rank each pool's tiers so cutoffs follow current prices. */
async function dailyTiers(db: PrismaClient, now: Date) {
  const day = new Date(now.getTime() - 24 * 60 * 60_000);
  const packs = await db.sitePack.findMany({ where: { OR: [{ tiersAt: null }, { tiersAt: { lte: day } }] }, select: { id: true } });
  let n = 0;
  for (const { id } of packs) {
    const has = await db.siteCopy.count({ where: { packId: id, status: "POOLED" } });
    if (!has) continue;
    await db.$transaction(
      async (tx) => {
        await lockPack(tx, id);
        await recomputeTiers(tx, id);
      },
      { timeout: 20_000 },
    );
    n++;
  }
  return n;
}

let timer: ReturnType<typeof setInterval> | undefined;
/** In-process hourly clock (checks every 5 minutes; runAutoRestock itself enforces once an hour). */
export function startAutoRestockClock(db: PrismaClient) {
  if (timer || process.env.CARDBIT_SITE !== "on" || process.env.NODE_ENV !== "production" || process.env.SITE_AUTO_RESTOCK === "off") return;
  const tick = () => {
    void runAutoRestock(db).catch(() => console.error("Cardbit auto restock will retry."));
  };
  timer = setInterval(tick, 5 * 60_000);
  timer.unref();
}

/** Public restock history per pack (newest first), for pack pages. No staff names. */
export async function restockHistory(db: Db, packIds: string[], take = 20) {
  if (!packIds.length) return new Map<string, ReturnType<typeof publicVersion>[]>();
  const rows = await db.siteRestock.findMany({
    where: { packId: { in: packIds }, status: "LIVE" },
    orderBy: [{ packId: "asc" }, { version: "desc" }],
    select: { packId: true, version: true, liveAt: true, addIds: true, removeIds: true, poolHash: true, poolSize: true, tiers: true, note: true },
  });
  const out = new Map<string, ReturnType<typeof publicVersion>[]>();
  for (const r of rows) {
    const list = out.get(r.packId) ?? [];
    if (list.length < take) list.push(publicVersion(r));
    out.set(r.packId, list);
  }
  return out;
}

function publicVersion(r: { version: number | null; liveAt: Date | null; addIds: unknown; removeIds: unknown; poolHash: string | null; poolSize: number | null; tiers: unknown; note: string | null }) {
  return {
    version: r.version!,
    at: r.liveAt?.toISOString() ?? null,
    added: (r.addIds as string[]).length,
    removed: (r.removeIds as string[]).length,
    poolSize: r.poolSize ?? 0,
    poolHash: r.poolHash!,
    addedTiers: (r.tiers as Record<string, number> | null) ?? {},
    starting: r.version === 1,
    note: r.note,
  };
}

/** One published version with its full card list, for the public verifier. */
export async function poolVersion(db: Db, packId: string, version: number) {
  const r = await db.siteRestock.findFirst({ where: { packId, version, status: "LIVE" } });
  if (!r) return null;
  const ids = r.poolIds as string[];
  const copies = ids.length ? await db.siteCopy.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, condition: true } }) : [];
  const byId = new Map(copies.map((c) => [c.id, c]));
  return {
    ...publicVersion(r),
    packId,
    addIds: r.addIds as string[],
    removeIds: r.removeIds as string[],
    poolIds: ids,
    cards: ids.map((id) => ({ id, title: byId.get(id)?.title ?? "Card", condition: byId.get(id)?.condition ?? null })),
    hashRule: "sha256 of poolIds (ascending) joined with newline",
  };
}

/** Staff view of every pack's staged restock with tier odds and internal EV now vs. after publish. */
export async function stagedRestocks(db: PrismaClient) {
  const packs = await db.sitePack.findMany({ orderBy: { sortOrder: "asc" } });
  const [staged, pooled, history, waiting, drafts] = await Promise.all([
    db.siteRestock.findMany({ where: { status: "STAGED" } }),
    db.siteCopy.findMany({
      where: { status: "POOLED", packId: { not: null } },
      select: { id: true, packId: true, printingKey: true, condition: true, retailBits: true, restockId: true, language: true, era: true, setName: true },
    }),
    restockHistory(db, packs.map((p) => p.id), 10),
    db.siteCopy.count({ where: { autoRestock: true, status: "DRAFT", restockId: null } }),
    db.siteCopy.findMany({ where: { status: "DRAFT", ownerId: null, restockId: null }, take: 3000 }),
  ]);
  const evRows = await db.siteRestock.findMany({ where: { status: "LIVE", packId: { in: packs.map((p) => p.id) } }, select: { packId: true, version: true, evPct: true }, orderBy: { version: "desc" } });
  const stagedCopies = staged.length ? await db.siteCopy.findMany({ where: { restockId: { in: staged.map((s) => s.id) } } }) : [];
  const draftValues = await retailOf(db, drafts);
  const nowTyped = pooled;
  return Promise.all(
    packs.map(async (p) => {
      const rules = tierRules(p.tierRules);
      const r = staged.find((s) => s.packId === p.id);
      const mine = r ? stagedCopies.filter((c) => c.restockId === r.id) : [];
      const adds = mine.filter((c) => c.status === "DRAFT");
      const removes = mine.filter((c) => c.status === "POOLED");
      const now = pooled.filter((c) => c.packId === p.id);
      const removeIds = new Set(removes.map((c) => c.id));
      const after = [...now.filter((c) => !removeIds.has(c.id)), ...adds];
      const odds = async (cards: typeof now, ladder = rules) => {
        const counts = await tierCounts(db, cards, ladder);
        const retail = await retailSum(db, cards);
        return { cards: cards.length, packs: Math.floor(cards.length / p.cardsPerPack), tiers: counts, retailBits: retail, evPct: evPct(retail, cards.length, p) };
      };
      const nowOdds = await odds(now);
      const projected = autoTierRules(await retailOf(db, after), tierMix(p.tierMix), p.topTierMin);
      const prize = isPrizePool(p);
      const nowValues = prize ? await retailOf(db, now) : [];
      const targets = fillTargets(p.fillTargets);
      const fill = prize
        ? targets.map((t) => ({ ...t, have: nowValues.filter((v) => v != null && inRange(v, t)).length }))
        : null;
      const band = evBand(p);
      const afterOdds = await odds(after, projected.cards ? projected.rules : rules);
      const needsRestock = Boolean(band && nowOdds.evPct != null && (nowOdds.evPct < band.lo || nowOdds.evPct > band.hi));
      const addOnly =
        needsRestock && !prize
          ? planRebalance(
              p,
              (await retailOf(db, now)).map((v, i) => rebalanceCard(now[i], v)),
              drafts.map((c, i) => rebalanceCard(c, draftValues[i])).filter((c, i) => !drafts[i].demo),
              { allowRemove: false },
            )
          : { inBand: false };
      // Suggestions: eligible Draft cards that move EV toward target the most (internal, staff only).
      const suggestions = prize
        ? drafts
            .map((c, i) => ({ c, v: draftValues[i] }))
            .filter(({ c, v }) => v && v > 0 && !ruleBreak(p, c, v) && (fill ?? []).some((t) => t.have < t.count && inRange(v, t)))
            .slice(0, 10)
            .map(({ c, v }) => ({ id: c.id, title: c.title, condition: c.condition, retailBits: v!, evAfterPct: null as number | null, slot: c.slot, pocket: c.pocket }))
        : p.targetEvPct == null || nowOdds.evPct == null
          ? []
          : drafts
              .map((c, i) => ({ c, v: draftValues[i] }))
              .filter(({ c, v }) => v && v > 0 && !ruleBreak(p, c, v))
              .map(({ c, v }) => ({ c, v: v!, after: evPct(nowOdds.retailBits + v!, now.length + 1, p)! }))
              .filter((x) => Math.abs(x.after - band!.aim) < Math.abs(nowOdds.evPct! - band!.aim))
              .sort((a, b) => Math.abs(a.after - band!.aim) - Math.abs(b.after - band!.aim))
              .slice(0, 10)
              .map(({ c, v, after: ev }) => ({ id: c.id, title: c.title, condition: c.condition, retailBits: v, evAfterPct: ev, slot: c.slot, pocket: c.pocket }));
      return {
        packId: p.id,
        title: p.title,
        kind: p.kind,
        fill,
        cardsPerPack: p.cardsPerPack,
        priceBits: p.priceBits,
        ev: { targetPct: p.targetEvPct, bandPct: p.evBandPct, minTopPer100: p.minTopPer100, languages: p.languages, eras: p.eras, needsRestock, autoDrafts: p.autoDrafts },
        // Buyback-loop margin (Trevor, Nov 27): 100 − 0.8 × EV; at least 10%, target 10–15%.
        loop: prize
          ? null
          : {
              buybackPct: LOOP_BUYBACK_SHARE * 100,
              minPct: LOOP_MARGIN_MIN,
              targetMaxPct: LOOP_MARGIN_TARGET_MAX,
              evCeilingPct: EV_CEILING,
              evLoopFloorPct: EV_LOOP_FLOOR,
              band: band ? { lo: band.lo, hi: band.hi, aim: band.aim, capped: band.capped } : null,
              marginNowPct: loopMarginPct(nowOdds.evPct),
              marginAfterPct: loopMarginPct(afterOdds.evPct),
              // What the hourly add-only fix could do with today's Drafts; false = staff need to press Reshuffle.
              draftsCanFix: needsRestock ? addOnly.inBand : null,
            },
        restockId: r?.id ?? null,
        adds: adds.map((c) => ({ id: c.id, title: c.title, condition: c.condition, slot: c.slot, pocket: c.pocket })),
        removes: removes.map((c) => ({ id: c.id, title: c.title, condition: c.condition, slot: c.slot, pocket: c.pocket })),
        now: nowOdds,
        // After publish, tiers re-rank on the new pool (auto tiers), so "after" odds use the projected cutoffs.
        after: afterOdds,
        rules: {
          minValueBits: p.minValueBits,
          maxValueBits: p.maxValueBits,
          typeCaps: p.typeCaps ?? null,
          tierMix: tierMix(p.tierMix),
          topTierMin: p.topTierMin,
          cutoffs: rules,
          cutoffsAfter: projected.cards ? projected.rules : rules,
          topShort: projected.topShort,
          tiersAt: p.tiersAt?.toISOString() ?? null,
          mix: typeCounts(nowTyped.filter((c) => c.packId === p.id)),
        },
        suggestions,
        history: (history.get(p.id) ?? []).map((h) => ({ ...h, evPct: evRows.find((e) => e.packId === p.id && e.version === h.version)?.evPct ?? null })),
        autoWaiting: waiting,
        // Listed Drafts this pack's rules accept (what Auto-Fill From Drafts may pick from, before the EV band check).
        draftsFit: drafts.filter((c, i) => !c.autoRestock && !c.demo && (draftValues[i] ?? 0) > 0 && !ruleBreak(p, c, draftValues[i]) && (!prize || targets.some((t) => inRange(draftValues[i]!, t)))).length,
        draftHoldMin: DRAFT_HOLD_MIN,
      };
    }),
  );
}

/** Staff: set a pack's EV target, band, top-tier minimum and eligible languages/eras. */
export async function savePackEv(db: PrismaClient, packId: string, b: Record<string, unknown>) {
  await packOrThrow(db, packId);
  const int = (v: unknown, lo: number, hi: number, label: string) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new RestockError(`${label} must be a whole number from ${lo} to ${hi}.`);
    return n;
  };
  const names = (v: unknown, allowed: string[], label: string) => {
    if (v === null || v === undefined || (Array.isArray(v) && !v.length)) return null;
    if (!Array.isArray(v) || v.some((x) => !allowed.includes(x))) throw new RestockError(`${label}: choose from ${allowed.join(", ")}.`);
    return [...new Set(v as string[])];
  };
  const pack = await packOrThrow(db, packId);
  const prize = isPrizePool(pack);
  const data: Prisma.SitePackUpdateInput = {};
  if (prize && "targetEvPct" in b && b.targetEvPct !== null && b.targetEvPct !== undefined && b.targetEvPct !== "")
    throw new RestockError("Prize pools aren't sold, so they have no EV. Use Fill Rules instead.");
  if ("fillTargets" in b) {
    if (!prize) throw new RestockError("Fill Rules are for prize pools (Daily Spins and the Spark Shop).");
    const raw = Array.isArray(b.fillTargets) ? b.fillTargets : [];
    if (raw.length > 12) throw new RestockError("Use 12 Fill Rule ranges or fewer.");
    const rows = raw.map((r: { minBits?: unknown; maxBits?: unknown; count?: unknown }) => ({
      minBits: int(r?.minBits, 0, 100_000_000, "Range minimum") ?? 0,
      maxBits: int(r?.maxBits, 1, 100_000_000, "Range maximum"),
      count: int(r?.count, 1, 5000, "Cards to keep") ?? 0,
    }));
    for (const r of rows) {
      if (!r.count) throw new RestockError("Each Fill Rule needs how many cards to keep.");
      if (r.maxBits != null && r.maxBits < r.minBits) throw new RestockError("Each range's minimum must be at or below its maximum.");
    }
    const sorted = rows.sort((a, b2) => a.minBits - b2.minBits);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      if (prev.maxBits == null || prev.maxBits >= sorted[i].minBits) throw new RestockError("Fill Rule ranges can't overlap.");
    }
    data.fillTargets = sorted.length ? sorted : Prisma_DbNull;
    if (!sorted.length && !("autoDrafts" in b)) data.autoDrafts = false;
  }
  // Only the fields a form sends change (the EV form and the Pool Rules form save separately).
  if ("targetEvPct" in b) {
    data.targetEvPct = int(b.targetEvPct, 10, 500, "Target EV");
    // Buyback-loop margin (Trevor, Nov 27): EV above 112.5% leaves under 10% margin. The band's top is cut there too.
    if (!prize && data.targetEvPct != null && data.targetEvPct > EV_CEILING)
      throw new RestockError(`Target EV can be at most ${Math.floor(EV_CEILING)}% so the buyback loop keeps at least a ${LOOP_MARGIN_MIN}% margin.`);
    data.evBandPct = int(b.evBandPct, 1, 50, "EV band") ?? 5;
    data.minTopPer100 = int(b.minTopPer100, 0, 100, "Top-tier minimum");
  }
  // Auto-Fill From Drafts (Trevor, Nov 25): the hourly auto-restock may also pool listed Draft cards. Off by default.
  if ("autoDrafts" in b) data.autoDrafts = b.autoDrafts === true;
  if ("languages" in b) data.languages = names(b.languages, ["English", "Japanese"], "Languages") ?? Prisma_DbNull;
  if ("eras" in b) data.eras = names(b.eras, ["Modern", "Vintage"], "Eras") ?? Prisma_DbNull;
  // Pool rules (Trevor, Nov 25): value range, max % per card type, tier mix and top-tier minimum value.
  if ("minValueBits" in b) data.minValueBits = int(b.minValueBits, 0, 100_000_000, "Minimum card value");
  if ("maxValueBits" in b) data.maxValueBits = int(b.maxValueBits, 1, 100_000_000, "Maximum card value");
  const lo = "minValueBits" in b ? data.minValueBits : undefined;
  const hi = "maxValueBits" in b ? data.maxValueBits : undefined;
  if (typeof lo === "number" && typeof hi === "number" && lo > hi) throw new RestockError("Minimum card value must be below the maximum.");
  if ("typeCaps" in b) {
    const raw = b.typeCaps && typeof b.typeCaps === "object" ? (b.typeCaps as Record<string, unknown>) : {};
    const out: Record<string, number> = {};
    for (const t of TYPES) {
      const n = int(raw[t], 1, 100, `${t} max %`);
      if (n != null && n < 100) out[t] = n;
    }
    data.typeCaps = Object.keys(out).length ? out : Prisma_DbNull;
  }
  if ("tierMix" in b) {
    if (b.tierMix == null || b.tierMix === "") data.tierMix = Prisma_DbNull;
    else {
      const raw = Array.isArray(b.tierMix) ? b.tierMix : [];
      const mix = DEFAULT_MIX.map((d, i) => ({ name: d.name, pct: Number((raw[i] as { pct?: unknown })?.pct ?? raw[i]) }));
      if (mix.some((m) => !Number.isFinite(m.pct) || m.pct < 0) || Math.abs(mix.reduce((a, m) => a + m.pct, 0) - 100) > 0.01 || mix[mix.length - 1].pct <= 0)
        throw new RestockError("Tier mix must add up to 100%, with some share for the top tier.");
      data.tierMix = mix;
    }
  }
  if ("topTierMin" in b) data.topTierMin = int(b.topTierMin, 1, 100_000_000, "Top-tier minimum value");
  if (data.autoDrafts === true) {
    if (prize) {
      const rules = "fillTargets" in b ? data.fillTargets : pack.fillTargets;
      if (!fillTargets(rules === Prisma_DbNull ? null : rules).length) throw new RestockError("Add Fill Rules before turning on Auto-Fill From Drafts.");
    } else {
      const target = "targetEvPct" in b ? data.targetEvPct : pack.targetEvPct;
      if (target == null) throw new RestockError("Set a Target EV before turning on Auto-Fill From Drafts.");
    }
  }
  // Clearing the Target EV also turns Auto-Fill From Drafts off for a pack (it can't run without one).
  if (!prize && "targetEvPct" in b && data.targetEvPct == null) data.autoDrafts = false;
  if (prize && "targetEvPct" in b) {
    delete data.targetEvPct;
    delete data.evBandPct;
  }
  const saved = await db.sitePack.update({ where: { id: packId }, data });
  // New mix or top-tier minimum: re-rank the pool now so staff see the effect.
  if ("tierMix" in b || "topTierMin" in b)
    await db.$transaction(async (tx) => {
      await lockPack(tx, packId);
      if (await tx.siteCopy.count({ where: { packId, status: "POOLED" } })) await recomputeTiers(tx, packId);
    });
  return saved;
}
