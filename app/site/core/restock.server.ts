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

async function lockPack(tx: Tx, packId: string) {
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

type RulePack = { languages: unknown; eras: unknown; minValueBits: number | null; maxValueBits: number | null; typeCaps: unknown };
const TYPES = ["English", "Japanese", "Modern", "Vintage"] as const;
type Mix = Record<string, number>;

/** Why a card can't join this pack's pool (null = it can). Value is Poke-Collect retail in Cardbits. */
export function ruleBreak(pack: RulePack, c: Pick<SiteCopy, "language" | "era" | "setName">, value: number | null) {
  if (!eligible(pack, c)) return "Not an eligible language or era for this pack.";
  if ((pack.minValueBits != null || pack.maxValueBits != null) && (value == null || value <= 0)) return "No price yet, so it can't be checked against this pack's value range.";
  if (pack.minValueBits != null && value! < pack.minValueBits) return `Below this pack's minimum value (${pack.minValueBits.toLocaleString("en-US")} Cardbits).`;
  if (pack.maxValueBits != null && value! > pack.maxValueBits) return `Above this pack's maximum value (${pack.maxValueBits.toLocaleString("en-US")} Cardbits).`;
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
async function applyRestock(
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
    if (p.targetEvPct == null || ruleBreak(p, card, value)) continue;
    if (st.mix && capBreak(p, addType(st.mix, card), st.cards + 1)) continue;
    const before = evPct(st.retail, st.cards, p);
    const after = evPct(st.retail + value, st.cards + 1, p)!;
    const lo = p.targetEvPct - p.evBandPct;
    const hi = p.targetEvPct + p.evBandPct;
    const gapBefore = before == null ? Infinity : Math.abs(before - p.targetEvPct);
    const gapAfter = Math.abs(after - p.targetEvPct);
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

const AUTO_KEY = "cardbit-site:auto-restock";

/**
 * Hourly automatic buyback restock (Trevor, Nov 25). Routes every sold-back Draft card still marked for auto
 * restock to the pool that needs it, then publishes one logged restock per pack it touched. Cards no pool
 * can take (no price, no eligible pack with a target, or every pool would leave its EV band) stay in Draft.
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
  if (!claimed.length) return { ran: false, routed: 0, held: 0, versions: [] as { packId: string; version: number }[], retiered: 0 };
  const retiered = await dailyTiers(db, now);
  const waiting = await db.siteCopy.findMany({ where: { autoRestock: true, status: "DRAFT", ownerId: null, restockId: null }, orderBy: { updatedAt: "asc" }, take: 2000 });
  if (!waiting.length) return { ran: true, routed: 0, held: 0, versions: [], retiered };
  const values = await retailOf(db, waiting);
  const states = await poolStates(db);
  const plan = new Map<string, SiteCopy[]>();
  // Highest value first, so scarce chase cards go where they're needed most.
  const order = waiting.map((c, i) => ({ c, v: values[i] })).sort((a, b) => (b.v ?? 0) - (a.v ?? 0));
  let held = 0;
  for (const { c, v } of order) {
    const st = v && v > 0 ? routeCard(v, c, states.values()) : null;
    if (!st) {
      held++;
      continue;
    }
    st.cards++;
    st.retail += v!;
    if (st.mix) st.mix = addType(st.mix, c);
    if (tierFor(v!, tierRules(st.pack.tierRules)) === st.topTier) st.top++;
    plan.set(st.pack.id, [...(plan.get(st.pack.id) ?? []), c]);
  }
  const versions: { packId: string; version: number }[] = [];
  let routed = 0;
  for (const [packId, cards] of plan) {
    const st = states.get(packId)!;
    const out = await db.$transaction(
      async (tx) => {
        await lockPack(tx, packId);
        const prev = await ensureBaseline(tx, packId, "auto-restock");
        // Only cards still waiting (staff may have listed or staged one meanwhile).
        const fresh = await tx.siteCopy.findMany({ where: { id: { in: cards.map((c) => c.id) }, autoRestock: true, status: "DRAFT", ownerId: null, restockId: null } });
        return applyRestock(tx, st.pack, prev, fresh, null, { actor: "auto-restock", note: "Buyback Restock", auto: true });
      },
      { timeout: 20_000 },
    );
    if (out) {
      versions.push({ packId, version: out.version! });
      routed += (out.addIds as string[]).length;
    }
  }
  return { ran: true, routed, held, versions, retiered };
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
      const band = p.targetEvPct == null ? null : { lo: p.targetEvPct - p.evBandPct, hi: p.targetEvPct + p.evBandPct };
      const needsRestock = Boolean(band && nowOdds.evPct != null && (nowOdds.evPct < band.lo || nowOdds.evPct > band.hi));
      // Suggestions: eligible Draft cards that move EV toward target the most (internal, staff only).
      const suggestions =
        p.targetEvPct == null || nowOdds.evPct == null
          ? []
          : drafts
              .map((c, i) => ({ c, v: draftValues[i] }))
              .filter(({ c, v }) => v && v > 0 && !ruleBreak(p, c, v))
              .map(({ c, v }) => ({ c, v: v!, after: evPct(nowOdds.retailBits + v!, now.length + 1, p)! }))
              .filter((x) => Math.abs(x.after - p.targetEvPct!) < Math.abs(nowOdds.evPct! - p.targetEvPct!))
              .sort((a, b) => Math.abs(a.after - p.targetEvPct!) - Math.abs(b.after - p.targetEvPct!))
              .slice(0, 10)
              .map(({ c, v, after: ev }) => ({ id: c.id, title: c.title, condition: c.condition, retailBits: v, evAfterPct: ev, slot: c.slot, pocket: c.pocket }));
      return {
        packId: p.id,
        title: p.title,
        cardsPerPack: p.cardsPerPack,
        priceBits: p.priceBits,
        ev: { targetPct: p.targetEvPct, bandPct: p.evBandPct, minTopPer100: p.minTopPer100, languages: p.languages, eras: p.eras, needsRestock },
        restockId: r?.id ?? null,
        adds: adds.map((c) => ({ id: c.id, title: c.title, condition: c.condition, slot: c.slot, pocket: c.pocket })),
        removes: removes.map((c) => ({ id: c.id, title: c.title, condition: c.condition, slot: c.slot, pocket: c.pocket })),
        now: nowOdds,
        // After publish, tiers re-rank on the new pool (auto tiers), so "after" odds use the projected cutoffs.
        after: await odds(after, projected.cards ? projected.rules : rules),
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
  const data: Prisma.SitePackUpdateInput = {
    targetEvPct: int(b.targetEvPct, 10, 500, "Target EV"),
    evBandPct: int(b.evBandPct, 1, 50, "EV band") ?? 5,
    minTopPer100: int(b.minTopPer100, 0, 100, "Top-tier minimum"),
  };
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
  const saved = await db.sitePack.update({ where: { id: packId }, data });
  // New mix or top-tier minimum: re-rank the pool now so staff see the effect.
  if ("tierMix" in b || "topTierMin" in b)
    await db.$transaction(async (tx) => {
      await lockPack(tx, packId);
      if (await tx.siteCopy.count({ where: { packId, status: "POOLED" } })) await recomputeTiers(tx, packId);
    });
  return saved;
}
