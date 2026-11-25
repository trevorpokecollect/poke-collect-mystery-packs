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
export async function drawForOpening<T extends { id: string }>(tx: Prisma.TransactionClient, customerId: string, openingId: string, pool: readonly T[], count: number, poolVersion: number | null = null) {
  const seed = await activeSeed(tx, customerId);
  const ordered = [...pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const picks = fairDraw(ordered, count, seed.serverSeed, seed.clientSeed, seed.nonce);
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
      poolIds: r.opening.sealed ? [] : (r.poolIds as string[]),
      pickIds: r.opening.sealed ? [] : (r.pickIds as string[]),
      picks: r.opening.sealed ? [] : (r.pickIds as string[]).map((id) => title.get(id) ?? "Card"),
      sealed: r.opening.sealed,
    })),
  };
}
