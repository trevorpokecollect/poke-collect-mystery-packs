// What a pool's cards would cost to buy in at our own StorePass buylist offers (cash and store
// credit), so each pool build shows the profit if the series sells out at buylist cost.
// Reads StorePass's public buylist search, the same one buylist.poke-collect.com uses.
import type { PrismaClient } from "@prisma/client";

const BUYLIST_HOST = process.env.STOREPASS_BUYLIST_HOST || "https://buylist.poke-collect.com";
const STORE_ID = process.env.STOREPASS_STORE_ID || "m26hgNVYeF";
const PRODUCT_LINES = ["Pokemon", "Pokemon Japanese"];

export interface BuylistReport {
  computedAt: string;
  copies: number;
  matchedCopies: number;
  cash: number;
  credit: number;
  /** Cards (copies) with no buylist offer, and their market value. */
  missing: { title: string; quantity: number; marketValue: number }[];
  byTier: Record<string, { copies: number; cash: number; market: number }>;
}

interface PoolCard {
  title: string;
  variantId: string;
  quantity: number;
  marketValue: number | string | { toString(): string };
  tier: string;
}

interface Offer {
  id: number;
  offer_price: number | null;
  offer_price_credit: number | null;
}

const numericId = (gid: string) => Number(gid.split("/").pop());
// Card titles are "<product title> - <variant title>".
const productTitle = (title: string) => (title.includes(" - ") ? title.slice(0, title.lastIndexOf(" - ")) : title);

async function offersFor(name: string, fetcher: typeof fetch): Promise<Map<number, Offer>> {
  const offers = new Map<number, Offer>();
  for (const line of PRODUCT_LINES) {
    const query = new URLSearchParams({ store_id: STORE_ID, product_line: line, mongo: "true", sort: "Relevance", buylist_products: "true", name });
    const response = await fetcher(`${BUYLIST_HOST}/saas/search?${query}`, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Poke-Collect Mystery Packs)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) console.error(`Buylist search for ${name} returned ${response.status}`);
    if (!response.ok) continue;
    const data = (await response.json()) as { products?: { store_pass_variant_info?: Offer[] }[] };
    for (const p of data.products ?? []) for (const v of p.store_pass_variant_info ?? []) offers.set(Number(v.id), v);
    if (offers.size) break;
  }
  return offers;
}

/** Prices every card in the pool at the buylist's cash and credit offers. */
export async function buildBuylistReport(cards: PoolCard[], fetcher: typeof fetch = fetch, concurrency = 6): Promise<BuylistReport> {
  const names = [...new Set(cards.map((c) => productTitle(c.title)))];
  const offers = new Map<number, Offer>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, names.length) }, async () => {
      while (next < names.length) {
        const name = names[next++];
        try {
          for (const [id, offer] of await offersFor(name, fetcher)) offers.set(id, offer);
        } catch (error) {
          console.error(`Buylist lookup for ${name} failed`, error);
        }
      }
    }),
  );

  const report: BuylistReport = { computedAt: new Date().toISOString(), copies: 0, matchedCopies: 0, cash: 0, credit: 0, missing: [], byTier: {} };
  for (const card of cards) {
    const market = Number(card.marketValue.toString());
    const tier = (report.byTier[card.tier] ??= { copies: 0, cash: 0, market: 0 });
    report.copies += card.quantity;
    tier.copies += card.quantity;
    tier.market += market * card.quantity;
    const offer = offers.get(numericId(card.variantId));
    if (offer?.offer_price == null) {
      report.missing.push({ title: card.title, quantity: card.quantity, marketValue: market });
      continue;
    }
    report.matchedCopies += card.quantity;
    report.cash += offer.offer_price * card.quantity;
    report.credit += (offer.offer_price_credit ?? offer.offer_price) * card.quantity;
    tier.cash += offer.offer_price * card.quantity;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  report.cash = round(report.cash);
  report.credit = round(report.credit);
  for (const t of Object.values(report.byTier)) {
    t.cash = round(t.cash);
    t.market = round(t.market);
  }
  return report;
}

/** Recomputes and saves the series' buylist report. Safe to call without awaiting. */
export async function refreshBuylistReport(db: PrismaClient, seriesId: string, fetcher: typeof fetch = fetch) {
  const cards = await db.card.findMany({ where: { seriesId } });
  const started = Date.now();
  console.log(`Buylist report for ${seriesId}: pricing ${cards.length} cards`);
  const report = await buildBuylistReport(cards, fetcher);
  console.log(`Buylist report for ${seriesId}: ${report.matchedCopies}/${report.copies} cards, cash $${report.cash} (${Date.now() - started}ms)`);
  await db.series.update({ where: { id: seriesId }, data: { buylistReport: report as never } });
  return report;
}
