// Price Guide for sellers in Vault Market: the card's TCGplayer market price, so a seller isn't listing blindly.
// It is only a suggestion shown to the card's owner while they set a price; buyers never see it, and the seller
// can still pick any price. Prices come from TCGCSV (https://tcgcsv.com), a free daily mirror of TCGplayer's prices.
// - The TCGplayer product id is the card image's file name (our singles listings use TCGplayer's image, "716225.jpg").
// - The set is the Shopify product's vendor, which equals the TCGCSV group name (Pokémon = category 3, Japan = 85).
// - The printing ("Holofoil", "Reverse Holofoil", "Normal"…) is read from the card title.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { PrismaClient } from "@prisma/client";
import { gql } from "./orders.server";

const BASE = "https://tcgcsv.com";
const UA = "PokeCollectMysteryPacks/1.0 (+https://poke-collect.com)";
const CATEGORIES = [3, 85];
const HOUR = 3_600_000;

export interface PriceRow {
  productId: number;
  subTypeName: string | null;
  marketPrice: number | null;
}

export interface PriceGuide {
  market: number | null;
  printing: string | null;
}

type Fetcher = typeof fetch;

const groupsCache = new Map<number, { at: number; byName: Map<string, number> }>();
const pricesCache = new Map<number, { at: number; rows: PriceRow[] }>();
const guideCache = new Map<string, { at: number; guide: PriceGuide }>();

async function getJSON(fetcher: Fetcher, path: string) {
  const res = await fetcher(`${BASE}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`TCGCSV ${path} returned ${res.status}`);
  return (await res.json()) as { results?: unknown[] };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

async function groupId(fetcher: Fetcher, setName: string, now: number) {
  for (const category of CATEGORIES) {
    let cached = groupsCache.get(category);
    if (!cached || now - cached.at > 12 * HOUR) {
      const data = await getJSON(fetcher, `/tcgplayer/${category}/groups`);
      const byName = new Map<string, number>();
      for (const g of (data.results ?? []) as { groupId: number; name: string }[]) byName.set(norm(g.name), g.groupId);
      cached = { at: now, byName };
      groupsCache.set(category, cached);
    }
    const id = cached.byName.get(norm(setName));
    if (id) return { category, id };
  }
  return null;
}

async function groupPrices(fetcher: Fetcher, category: number, id: number, now: number) {
  const cached = pricesCache.get(id);
  if (cached && now - cached.at < 6 * HOUR) return cached.rows;
  const data = await getJSON(fetcher, `/tcgplayer/${category}/${id}/prices`);
  const rows = (data.results ?? []) as PriceRow[];
  pricesCache.set(id, { at: now, rows });
  return rows;
}

/** The TCGplayer product id from a card image named after it ("…/files/716225.jpg?v=1"), or null. */
export function tcgplayerIdFromImage(url: string | null | undefined) {
  const m = url?.match(/\/(\d{3,9})(?:_[^/?]*)?\.(?:jpe?g|png|webp)(?:\?|$)/i);
  return m ? Number(m[1]) : null;
}

/** The row for the card's printing: the longest printing name found in its title, else the only priced row. */
export function pickRow(rows: PriceRow[], title: string) {
  const priced = rows.filter((r) => typeof r.marketPrice === "number" && r.marketPrice > 0);
  const t = title.toLowerCase();
  const named = [...priced]
    .filter((r) => r.subTypeName && t.includes(r.subTypeName.toLowerCase()))
    .sort((a, b) => (b.subTypeName?.length ?? 0) - (a.subTypeName?.length ?? 0))[0];
  if (named) return named;
  const normal = priced.find((r) => r.subTypeName === "Normal");
  if (normal && priced.length > 1 && !/holo/i.test(title)) return normal;
  return priced.length === 1 ? priced[0] : null;
}

/** Price Guide for one of the viewer's own vault cards. Never throws: no guide is fine. */
export async function priceGuideFor(
  db: PrismaClient,
  admin: AdminApiContext,
  shop: string,
  customerId: string,
  pullId: string,
  { fetcher = fetch as Fetcher, now = Date.now() } = {},
): Promise<PriceGuide> {
  const none = { market: null, printing: null };
  const pull = await db.pull.findFirst({ where: { id: pullId, shop, customerId }, include: { slot: { include: { card: true } } } });
  const card = pull?.slot.card;
  if (!card) return none;
  return guideForCard(admin, card, { fetcher, now });
}

type GuideCard = { id: string; productId: string; imageUrl: string | null; title: string };

/** Price Guide for one pool card (cached 6 hours). Never throws: no guide is fine. */
export async function guideForCard(
  admin: AdminApiContext,
  card: GuideCard,
  { fetcher = fetch as Fetcher, now = Date.now(), vendor }: { fetcher?: Fetcher; now?: number; vendor?: string | null } = {},
): Promise<PriceGuide> {
  const none = { market: null, printing: null };
  const cached = guideCache.get(card.id);
  if (cached && now - cached.at < 6 * HOUR) return cached.guide;
  try {
    const productId = tcgplayerIdFromImage(card.imageUrl);
    if (!productId) return none;
    let setName = vendor;
    if (setName === undefined) {
      const data = await gql(admin, `#graphql
        query PriceGuideProduct($id: ID!) { product(id: $id) { vendor } }`, { id: card.productId });
      setName = data.product?.vendor as string | undefined;
    }
    if (!setName) return none;
    const group = await groupId(fetcher, setName, now);
    if (!group) return none;
    const rows = (await groupPrices(fetcher, group.category, group.id, now)).filter((r) => r.productId === productId);
    const row = pickRow(rows, card.title);
    const guide = row ? { market: Math.round(row.marketPrice! * 100) / 100, printing: row.subTypeName } : none;
    guideCache.set(card.id, { at: now, guide });
    return guide;
  } catch (error) {
    console.error(`Price guide for card ${card.id} failed`, error);
    return none;
  }
}

export type Deal = "great" | "good" | "fair" | "high" | "over";

/** The same bands as the seller's Price Guide slider. */
export function dealFor(price: number, market: number | null): Deal | null {
  if (!market || !(price > 0)) return null;
  const ratio = price / market;
  if (ratio <= 0.9) return "great";
  if (ratio <= 1.02) return "good";
  if (ratio <= 1.15) return "fair";
  if (ratio <= 1.4) return "high";
  return "over";
}

/**
 * Deal badges for buyers on listed cards: how each price compares with the TCGplayer market.
 * Only the rating is shared, never the market price. Waits at most `waitMs`; cards not ready by
 * then get no badge this time and fill in on a later load (the lookups keep going and are cached).
 */
export async function dealBadges(
  db: PrismaClient,
  admin: AdminApiContext | undefined,
  listed: { pullId: string; price: number }[],
  { waitMs = 2500, fetcher = fetch as Fetcher }: { waitMs?: number; fetcher?: Fetcher } = {},
) {
  const out = new Map<string, Deal>();
  if (!admin || listed.length === 0) return out;
  const pulls = await db.pull.findMany({ where: { id: { in: listed.map((l) => l.pullId) } }, include: { slot: { include: { card: true } } } });
  const cards = new Map(pulls.map((p) => [p.id, p.slot.card]));
  const now = Date.now();
  const missing = [...new Set(pulls.map((p) => p.slot.card).filter((c) => !guideCache.has(c.id) && tcgplayerIdFromImage(c.imageUrl)).map((c) => c.productId))];
  const work = (async () => {
    const vendors = new Map<string, string | null>();
    for (let i = 0; i < missing.length; i += 100) {
      const data = await gql(admin, `#graphql
        query PriceGuideVendors($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id vendor } } }`, { ids: missing.slice(i, i + 100) });
      for (const n of (data.nodes ?? []) as ({ id: string; vendor: string } | null)[]) if (n) vendors.set(n.id, n.vendor);
    }
    await Promise.all(
      [...new Map(pulls.map((p) => [p.slot.card.id, p.slot.card])).values()].map((c) =>
        guideForCard(admin, c, { fetcher, now, vendor: guideCache.has(c.id) ? undefined : (vendors.get(c.productId) ?? null) }),
      ),
    );
  })().catch((error) => console.error("Deal badges failed", error));
  await Promise.race([work, new Promise((r) => setTimeout(r, waitMs))]);
  for (const l of listed) {
    const card = cards.get(l.pullId);
    const guide = card ? guideCache.get(card.id)?.guide : undefined;
    const deal = dealFor(l.price, guide?.market ?? null);
    if (deal) out.set(l.pullId, deal);
  }
  return out;
}
