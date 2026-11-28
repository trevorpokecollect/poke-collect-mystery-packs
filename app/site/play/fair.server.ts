// Verified Shuffle: per-customer commit-reveal seeds for every paid pack opening on the site.
//
// How a draw works (Boxed.gg calls theirs "Provably Fair"; ours is a physical-card version):
// - Each customer has one active server seed. We show its SHA-256 hash before any opening, so the
//   seed can't be changed afterwards. The customer can set their own client seed at any time.
// - Opening n with that seed uses nonce n. The pack's remaining cards are listed in a fixed order
//   (copy id ascending) and drawn without replacement. Pick i (0-based) takes index
//     HMAC_SHA256(key = serverSeed, msg = `${clientSeed}:${nonce}:${i}`) → first 13 hex digits → integer
//     mod (cards left)
//   from the list, removing each pick before the next.
// - Rule 2, "Different Cards" (Trevor, Nov 27 2026): a pack never holds two copies of the same printing
//   (same TCGplayer product, finish and language, any condition). Every possible pack made of different
//   printings is numbered and one number is picked:
//     R = HMAC_SHA256(key = serverSeed, msg = `${clientSeed}:${nonce}`) → all 64 hex digits → integer
//         mod (number of possible packs)
//   See distinctDraw() for the numbering. Each possible pack is equally likely, so every copy's chance is
//   exact and the pack page odds come from the same count. Openings made before Nov 27 2026 used rule 1
//   (the pick-by-pick formula above) and still verify with it; every seed active at the switch was revealed.
// - When the customer rotates the seed, we reveal the old one. Anyone can then recompute every
//   opening made with it (the Verified Shuffle page does it in the browser).
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newServerSeed = () => randomBytes(32).toString("hex");
const newClientSeed = () => randomBytes(8).toString("hex");

export class FairInputError extends Error {
  readonly code = "invalid";
}

/** Index for pick i out of `left` remaining cards. Shared by server, tests and the browser verifier. */
export function fairIndex(serverSeed: string, clientSeed: string, nonce: number, i: number, left: number) {
  const h = createHmac("sha256", serverSeed).update(`${clientSeed}:${nonce}:${i}`).digest("hex");
  return parseInt(h.slice(0, 13), 16) % left;
}

/** Draw `count` items from `pool` (already in fixed order) without replacement. */
export function fairDraw<T>(pool: readonly T[], count: number, serverSeed: string, clientSeed: string, nonce: number): T[] {
  const left = pool.slice();
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(left.splice(fairIndex(serverSeed, clientSeed, nonce, i, left.length), 1)[0]);
  return out;
}

/** Current draw rule for new openings. 1 = pick by pick (before Nov 27 2026), 2 = different printings per pack. */
export const DRAW_RULE = 2;

/**
 * Group label for each copy of an id-ordered pool: the position of the first copy with the same printing.
 * Copies with the same label are the same card; the labels reveal nothing else.
 */
export function printingGroups(ordered: readonly { printingKey: string }[]) {
  const first = new Map<string, number>();
  return ordered.map((c, i) => {
    if (!first.has(c.printingKey)) first.set(c.printingKey, i);
    return first.get(c.printingKey)!;
  });
}

/** Copy indexes per printing, printings in order of first appearance. */
function groupLists(groups: readonly number[]) {
  const members = new Map<number, number[]>();
  groups.forEach((g, i) => {
    const l = members.get(g);
    if (l) l.push(i);
    else members.set(g, [i]);
  });
  return [...members.values()];
}

/** Elementary symmetric sums e_0..e_k of the weights, as BigInt (e_r = ways to choose r different groups, one copy each). */
function esym(weights: readonly number[], k: number) {
  const e = [1n, ...new Array<bigint>(k).fill(0n)];
  for (const w of weights) for (let r = k; r >= 1; r--) e[r] += BigInt(w) * e[r - 1];
  return e;
}

/** Number of different packs of `k` cards with no printing twice, given copies per printing. */
export function distinctPacks(weights: readonly number[], k: number) {
  return esym(weights, k)[k];
}

/**
 * Most packs the pool can still fill with `k` different printings each: largest p ≤ cards/k with
 * Σ min(copies, p) ≥ k·p. Copies past that wait for a restock that adds other cards.
 */
export function maxDistinctPacks(weights: readonly number[], k: number) {
  const n = weights.reduce((a, w) => a + w, 0);
  for (let p = Math.floor(n / k); p > 0; p--) if (weights.reduce((a, w) => a + Math.min(w, p), 0) >= k * p) return p;
  return 0;
}

/**
 * Exact chances for a rule 2 pack. `tierOf(i)` names copy i's tier. Returns each copy's chance of being in the
 * pack (every copy of a printing is equally likely) and each tier's chance of at least one card in the pack.
 */
export function distinctOdds(groups: readonly number[], k: number, tierOf: (i: number) => string) {
  const lists = groupLists(groups);
  const weights = lists.map((l) => l.length);
  const e = esym(weights, k);
  const total = e[k];
  const ratio = (num: bigint) => (total > 0n ? Number((num * 1_000_000_000_000n) / total) / 1e12 : 0);
  const copy = new Array<number>(groups.length).fill(0);
  for (const l of lists) {
    // e_{k-1} without this group: f_r = e_r − w·f_{r-1}.
    const w = BigInt(l.length);
    let f = 1n;
    for (let r = 1; r <= k - 1; r++) f = e[r] - w * f;
    const each = ratio(f);
    for (const i of l) copy[i] = each;
  }
  const tiers = new Map<string, number>();
  for (const name of new Set(groups.map((_, i) => tierOf(i)))) {
    const without = lists.map((l) => l.filter((i) => tierOf(i) !== name).length);
    tiers.set(name, total > 0n ? 1 - ratio(esym(without, k)[k]) : 0);
  }
  return { copy, tiers };
}

/**
 * Rule 2 draw: indexes (into the id-ordered pool) of a pack with `count` different printings.
 * Printings are taken in order of first appearance; copies of a printing in id order. Possible packs are
 * numbered by walking the printings: for printing j with w copies, the numbers that include it come first,
 * w·e_{r-1}(later printings) of them (copy = number ÷ e_{r-1}(later), rest = number mod e_{r-1}(later)),
 * then the ones that skip it. R picks one number. Returns null when no such pack exists.
 */
export function distinctDraw(groups: readonly number[], count: number, serverSeed: string, clientSeed: string, nonce: number): number[] | null {
  const lists = groupLists(groups);
  // suffix[j][r] = e_r of printings j.. (end)
  const suffix: bigint[][] = new Array(lists.length + 1);
  suffix[lists.length] = [1n, ...new Array<bigint>(count).fill(0n)];
  for (let j = lists.length - 1; j >= 0; j--) {
    const w = BigInt(lists[j].length);
    const next = suffix[j + 1];
    suffix[j] = next.map((v, r) => (r === 0 ? v : v + w * next[r - 1]));
  }
  const total = suffix[0][count];
  if (total === 0n) return null;
  let R = BigInt(`0x${createHmac("sha256", serverSeed).update(`${clientSeed}:${nonce}`).digest("hex")}`) % total;
  const out: number[] = [];
  let r = count;
  for (let j = 0; j < lists.length && r > 0; j++) {
    const w = BigInt(lists[j].length);
    const rest = suffix[j + 1][r - 1];
    if (R < w * rest) {
      out.push(lists[j][Number(R / rest)]);
      R %= rest;
      r--;
    } else R -= w * rest;
  }
  return out;
}

export class NoDistinctPack extends Error {}

/** The customer's active seed, created on first use. */
export async function activeSeed(db: Db, customerId: string) {
  const cur = await db.siteFairSeed.findFirst({ where: { customerId, revealedAt: null }, orderBy: { createdAt: "desc" } });
  if (cur) return cur;
  const serverSeed = newServerSeed();
  // ON CONFLICT DO NOTHING: a concurrent first use (unique partial index) keeps the other row.
  await db.siteFairSeed.createMany({ data: [{ customerId, serverSeed, serverSeedHash: sha256(serverSeed), clientSeed: newClientSeed() }], skipDuplicates: true });
  return db.siteFairSeed.findFirstOrThrow({ where: { customerId, revealedAt: null }, orderBy: { createdAt: "desc" } });
}

/**
 * Draw for an opening inside the caller's transaction (which already holds the customer lock),
 * advance the nonce and record everything needed to verify it later.
 */
export async function drawForOpening<T extends { id: string; printingKey: string }>(tx: Prisma.TransactionClient, customerId: string, openingId: string, pool: readonly T[], count: number, poolVersion: number | null = null) {
  const seed = await activeSeed(tx, customerId);
  const ordered = [...pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const groups = printingGroups(ordered);
  const idx = distinctDraw(groups, count, seed.serverSeed, seed.clientSeed, seed.nonce);
  if (!idx) throw new NoDistinctPack("Not enough different cards left for a pack.");
  const picks = idx.map((i) => ordered[i]);
  await tx.siteFairSeed.update({ where: { id: seed.id }, data: { nonce: { increment: 1 } } });
  await tx.siteOpeningFair.create({
    data: {
      openingId,
      seedId: seed.id,
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: seed.nonce,
      poolIds: ordered.map((c) => c.id),
      pickIds: picks.map((c) => c.id),
      poolVersion,
      drawRule: DRAW_RULE,
      poolGroups: groups,
    },
  });
  return picks;
}

/** Change the client seed for future openings (letters, numbers, - and _, 1–64 chars). */
export async function setClientSeed(db: Db, customerId: string, raw: string) {
  const clientSeed = raw.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(clientSeed)) throw new FairInputError("Use 1–64 letters, numbers, dashes or underscores.");
  const seed = await activeSeed(db, customerId);
  await db.siteFairSeed.update({ where: { id: seed.id }, data: { clientSeed } });
}

/** Reveal the active server seed and start a new one (keeps the client seed). */
export async function rotateSeed(db: PrismaClient, customerId: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`site-customer:${customerId}`}, 0))::text`;
    const cur = await activeSeed(tx, customerId);
    await tx.siteFairSeed.update({ where: { id: cur.id }, data: { revealedAt: new Date() } });
    const serverSeed = newServerSeed();
    return tx.siteFairSeed.create({ data: { customerId, serverSeed, serverSeedHash: sha256(serverSeed), clientSeed: cur.clientSeed } });
  });
}

/** What the Verified Shuffle page shows the signed-in customer. Server seeds only once revealed. */
export async function fairView(db: Db, customerId: string, take = 50) {
  const seed = await activeSeed(db, customerId);
  const rows = await db.siteOpeningFair.findMany({
    where: { opening: { customerId } },
    orderBy: { createdAt: "desc" },
    take,
    include: { seed: true, opening: { select: { packId: true, createdAt: true, sealed: true } } },
  });
  const pickIds = rows.flatMap((r) => r.pickIds as string[]);
  const copies = pickIds.length ? await db.siteCopy.findMany({ where: { id: { in: pickIds } }, select: { id: true, title: true } }) : [];
  const title = new Map(copies.map((c) => [c.id, c.title]));
  const packs = await db.sitePack.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.opening.packId))] } }, select: { id: true, title: true } });
  const packTitle = new Map(packs.map((p) => [p.id, p.title]));
  return {
    active: { serverSeedHash: seed.serverSeedHash, clientSeed: seed.clientSeed, nonce: seed.nonce },
    openings: rows.map((r) => ({
      openingId: r.openingId,
      packId: r.opening.packId,
      packTitle: packTitle.get(r.opening.packId) ?? r.opening.packId,
      at: r.opening.createdAt.toISOString(),
      serverSeedHash: r.serverSeedHash,
      serverSeed: r.seed.revealedAt ? r.seed.serverSeed : null,
      clientSeed: r.clientSeed,
      nonce: r.nonce,
      poolVersion: r.poolVersion,
      drawRule: r.drawRule,
      poolGroups: r.opening.sealed || !Array.isArray(r.poolGroups) ? [] : (r.poolGroups as number[]),
      poolIds: r.opening.sealed ? [] : (r.poolIds as string[]),
      pickIds: r.opening.sealed ? [] : (r.pickIds as string[]),
      picks: r.opening.sealed ? [] : (r.pickIds as string[]).map((id) => title.get(id) ?? "Card"),
      sealed: r.opening.sealed,
    })),
  };
}
