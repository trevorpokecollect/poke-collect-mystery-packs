import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/** The highest tier in a series' rules (e.g. "Master"), or null when it has no rules. */
export function topTierName(tierRules: unknown): string | null {
  if (!Array.isArray(tierRules)) return null;
  const rules = tierRules.filter(
    (r): r is { name: string; min: number } => typeof r?.name === "string" && typeof r?.min === "number",
  );
  if (!rules.length) return null;
  return rules.reduce((top, r) => (r.min > top.min ? r : top)).name;
}

/** Pulls the customer has seen. Unopened packs never show, so nothing is given away before the reveal. */
const SEEN = { status: { in: ["REVEALED", "FULFILLING"] as ("REVEALED" | "FULFILLING")[] }, revealedAt: { not: null } };

const SELECT = {
  id: true,
  revealedAt: true,
  series: { select: { title: true, packProductId: true, tierRules: true } },
  slot: { select: { card: { select: { title: true, tier: true, imageUrl: true } } } },
} as const;

type Row = Prisma.PullGetPayload<{ select: typeof SELECT }>;

/** Public shape: no customer, order or dollar value, just the card and when it was pulled. */
function publicPull(p: Row) {
  return {
    id: p.id,
    card: p.slot.card.title,
    tier: p.slot.card.tier,
    imageUrl: p.slot.card.imageUrl,
    pack: p.series.title,
    productId: p.series.packProductId.split("/").pop() ?? null,
    topTier: p.slot.card.tier === (topTierName(p.series.tierRules) ?? "Master"),
    pulledAt: (p.revealedAt as Date).toISOString(),
  };
}

/** Newest revealed pulls, optionally only from packs sold through one product. */
export async function recentPulls(db: Db, shop: string, opts: { productId?: string | null; limit?: number } = {}) {
  const rows = await db.pull.findMany({
    where: { shop, ...SEEN, ...(opts.productId ? { series: { packProductId: opts.productId } } : {}) },
    orderBy: { revealedAt: "desc" },
    take: Math.min(Math.max(opts.limit ?? 12, 1), 30),
    select: SELECT,
  });
  return rows.map(publicPull);
}

/** The newest revealed card from each series' top tier (Master), across every pack line or one product. */
export async function latestTopTierPull(db: Db, shop: string, productId?: string | null) {
  const series = await db.series.findMany({
    where: { shop, status: { not: "DRAFT" }, ...(productId ? { packProductId: productId } : {}) },
    select: { id: true, tierRules: true },
  });
  if (!series.length) return null;
  const row = await db.pull.findFirst({
    where: {
      shop,
      ...SEEN,
      OR: series.map((s) => ({ seriesId: s.id, slot: { card: { tier: topTierName(s.tierRules) ?? "Master" } } })),
    },
    orderBy: { revealedAt: "desc" },
    select: SELECT,
  });
  return row ? publicPull(row) : null;
}
