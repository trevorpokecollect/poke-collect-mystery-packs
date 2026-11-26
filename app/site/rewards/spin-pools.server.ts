// Daily Spin prize pools on the standalone site (Trevor, Nov 26 2026). Each spin has its own SitePack pool
// (kind "spin", id "spin-<tier id>") with the same tools as pack pools: Pool Rules, auto tiers, staged and
// published restocks, Auto-Fill From Drafts and Fill Rules. A card result takes one random copy from that pool
// straight into the winner's Vault. Official Rules C4 caps are enforced here: a card above the spin's maximum
// prize value is never awarded, and card prizes stop once their total value would pass the promotion cap.
import { randomInt } from "node:crypto";
import type { Prisma, PrismaClient, SiteCopy } from "@prisma/client";
import { priceKey } from "../core/stock.server";
import { ensureBaseline } from "../core/restock.server";
import { tierFor, tierRules } from "../store/tiers";
import { cardImage } from "../core/card-image";

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

export const spinPoolId = (tier: string) => "spin-" + tier;

/** Official Rules C4: maximum value of one card prize per spin, in Cardbits (100 = $1). */
export const SPIN_CARD_CAP_BITS: Record<string, number> = {
  basic: 500,
  bronze: 750,
  silver: 1000,
  gold: 2500,
  cobalt: 5000,
  holo: 10000,
};
/** Official Rules C4: total value of all card prizes during the Promotion Period ($4,900). */
export const SPIN_TOTAL_CAP_BITS = 490_000;

async function lockPool(tx: Tx, packId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`site-pack:${packId}`}, 0))::text`;
}

/** Cardbit retail of each copy (copy override, else its printing+condition price). */
export async function copyValues(db: Db, copies: Pick<SiteCopy, "printingKey" | "condition" | "retailBits">[]) {
  const keys = [...new Set(copies.map((c) => priceKey(c.printingKey, c.condition)))];
  const prices = keys.length ? await db.sitePrice.findMany({ where: { printingKey: { in: keys } } }) : [];
  const byKey = new Map(prices.map((p) => [p.printingKey, p.retailBits]));
  return copies.map((c) => c.retailBits ?? byKey.get(priceKey(c.printingKey, c.condition)) ?? null);
}

/** Card prize value already awarded on the site (Official Rules total cap). */
export async function spinPrizeTotal(db: Db, shop: string) {
  const r = await db.cardbitSpin.aggregate({ where: { shop, prizeKind: "card" }, _sum: { valueBits: true } });
  return r._sum.valueBits ?? 0;
}

/**
 * Draw one card for a spin, inside the spin's transaction. Only priced copies at or under the spin's cap (and
 * the remaining promotion budget) qualify. Returns null when nothing qualifies (the spin then pays Sparks).
 */
export async function drawSiteSpinCard(tx: Tx, shop: string, customerId: string, tier: string, spinId: string) {
  const packId = spinPoolId(tier);
  const pool = await tx.sitePack.findUnique({ where: { id: packId } });
  if (!pool || pool.kind !== "spin") return null;
  await lockPool(tx, packId);
  await ensureBaseline(tx, packId, "spin");
  const cands = await tx.siteCopy.findMany({ where: { packId, status: "POOLED", ownerId: null }, orderBy: { id: "asc" } });
  if (!cands.length) return null;
  const values = await copyValues(tx, cands);
  const budget = SPIN_TOTAL_CAP_BITS - (await spinPrizeTotal(tx, shop));
  const cap = Math.min(SPIN_CARD_CAP_BITS[tier] ?? 0, budget);
  const ok = cands.map((c, i) => ({ c, v: values[i] })).filter((x) => x.v != null && x.v > 0 && x.v <= cap);
  if (!ok.length) return null;
  const pick = ok[randomInt(ok.length)];
  const rules = tierRules(pool.tierRules);
  const n = await tx.siteCopy.updateMany({
    where: { id: pick.c.id, status: "POOLED", packId, ownerId: null },
    data: { status: "VAULTED", ownerId: customerId, packId: null, restockId: null, orderId: "spin:" + spinId, pulledTier: tierFor(pick.v, rules) ?? "Unpriced", acquiredVia: "spin" },
  });
  if (!n.count) return null;
  await tx.siteCopyEvent.create({ data: { copyId: pick.c.id, fromStatus: "POOLED", toStatus: "VAULTED", actor: `customer:${customerId}`, reason: `daily spin ${tier} ${spinId}` } });
  return { copyId: pick.c.id, valueBits: pick.v! };
}

/** The won card's public details (no value): title, image and rarity tier. */
export async function siteSpinCard(db: Db, copyId: string | null) {
  if (!copyId) return null;
  const c = await db.siteCopy.findUnique({ where: { id: copyId } });
  return c ? { title: c.title, imageUrl: cardImage(c), tier: c.pulledTier } : null;
}

/** Cards a spin can land on now (grouped by printing and condition), for the Rewards page. */
export async function siteSpinCards(db: Db, shop: string, tier: string) {
  const packId = spinPoolId(tier);
  const pool = await db.sitePack.findUnique({ where: { id: packId }, select: { tierRules: true, kind: true } });
  if (!pool || pool.kind !== "spin") return [];
  const copies = await db.siteCopy.findMany({ where: { packId, status: "POOLED", ownerId: null } });
  const values = await copyValues(db, copies);
  const cap = Math.min(SPIN_CARD_CAP_BITS[tier] ?? 0, SPIN_TOTAL_CAP_BITS - (await spinPrizeTotal(db, shop)));
  const rules = tierRules(pool.tierRules);
  const groups = new Map<string, { title: string; imageUrl: string | null; rarity: string | null; left: number; v: number }>();
  copies.forEach((c, i) => {
    const v = values[i];
    if (v == null || v <= 0 || v > cap) return;
    const key = c.printingKey + "|" + c.condition;
    const g = groups.get(key);
    if (g) g.left++;
    else groups.set(key, { title: c.title, imageUrl: cardImage(c), rarity: tierFor(v, rules), left: 1, v });
  });
  // Best cards first; values stay server-side.
  return [...groups.values()].sort((a, b) => b.v - a.v).map(({ v: _v, ...g }) => g);
}
