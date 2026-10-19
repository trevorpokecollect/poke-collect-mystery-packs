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
  const cached = guideCache.get(card.id);
  if (cached && now - cached.at < 6 * HOUR) return cached.guide;
  try {
    const productId = tcgplayerIdFromImage(card.imageUrl);
    if (!productId) return none;
    const data = await gql(admin, `#graphql
      query PriceGuideProduct($id: ID!) { product(id: $id) { vendor } }`, { id: card.productId });
    const vendor = data.product?.vendor as string | undefined;
    if (!vendor) return none;
    const group = await groupId(fetcher, vendor, now);
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
