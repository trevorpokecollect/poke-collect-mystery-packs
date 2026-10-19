// What a pool's cards would cost to buy in at our own Card Broker buylist offers (cash and store credit), and what
// they're worth at Card Broker retail, so each pool build shows the profit if the series sells out at buylist cost.
// Trevor 2026-10-19: every profit report uses Card Broker's buylist and retail prices, not Storepass. Reads Card
// Broker's variant offers through its app proxy (poke-collect.com/apps/buylist/singles/variant-offers).
import type { PrismaClient } from "@prisma/client";

const OFFERS_URL = process.env.CARD_BROKER_OFFERS_URL || "https://poke-collect.com/apps/buylist/singles/variant-offers";
/** Reports from before the switch (Storepass) have no source and are recomputed. */
export const BUYLIST_SOURCE = "card-broker";
const BATCH = 100;

export interface BuylistReport {
  source?: string;
  computedAt: string;
  copies: number;
  matchedCopies: number;
  cash: number;
  credit: number;
  /** Matched copies at Card Broker retail (our Near Mint price, or the variant's Shopify price). */
  retail?: number;
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
  variantId: string;
  cash: number | null;
  credit: number | null;
  retail: number | null;
}

const numericId = (gid: string) => gid.split("/").pop() ?? gid;

async function offersFor(ids: string[], fetcher: typeof fetch): Promise<Offer[]> {
  const response = await fetcher(`${OFFERS_URL}?variants=${ids.join(",")}`, {
    headers: { Accept: "application/json", "User-Agent": "Poke-Collect Mystery Packs" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Card Broker offers returned ${response.status}`);
  const data = (await response.json()) as { offers?: Offer[] };
  return data.offers ?? [];
}

/** Prices every card in the pool at Card Broker's cash and credit offers and retail. */
export async function buildBuylistReport(cards: PoolCard[], fetcher: typeof fetch = fetch): Promise<BuylistReport> {
  const ids = [...new Set(cards.map((c) => numericId(c.variantId)))];
  const offers = new Map<string, Offer>();
  for (let i = 0; i < ids.length; i += BATCH) {
    for (const o of await offersFor(ids.slice(i, i + BATCH), fetcher)) offers.set(String(o.variantId), o);
  }

  const report: BuylistReport = { source: BUYLIST_SOURCE, computedAt: new Date().toISOString(), copies: 0, matchedCopies: 0, cash: 0, credit: 0, retail: 0, missing: [], byTier: {} };
  for (const card of cards) {
    const market = Number(card.marketValue.toString());
    const tier = (report.byTier[card.tier] ??= { copies: 0, cash: 0, market: 0 });
    report.copies += card.quantity;
    tier.copies += card.quantity;
    tier.market += market * card.quantity;
    const offer = offers.get(numericId(card.variantId));
    if (offer?.cash == null) {
      report.missing.push({ title: card.title, quantity: card.quantity, marketValue: market });
      continue;
    }
    report.matchedCopies += card.quantity;
    report.cash += offer.cash * card.quantity;
    report.credit += (offer.credit ?? offer.cash) * card.quantity;
    report.retail! += (offer.retail ?? market) * card.quantity;
    tier.cash += offer.cash * card.quantity;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  report.cash = round(report.cash);
  report.credit = round(report.credit);
  report.retail = round(report.retail!);
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
  console.log(`Buylist report for ${seriesId}: pricing ${cards.length} cards at Card Broker`);
  const report = await buildBuylistReport(cards, fetcher);
  console.log(`Buylist report for ${seriesId}: ${report.matchedCopies}/${report.copies} cards, cash $${report.cash} (${Date.now() - started}ms)`);
  await db.series.update({ where: { id: seriesId }, data: { buylistReport: report as never } });
  return report;
}
