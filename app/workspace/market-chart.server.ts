import { UNSAFE_decodeViaTurboStream as decode } from "react-router";
import { site } from "./sources.server";

type Printing = { key: string; product: number; game: string; finish: string };
type Prices = [string, number][];
type CatalogCard = {
  id: string;
  game: string;
  printing: string;
  tcgplayerId: number;
};
type ChartData = {
  card: { id: string; game: string; printing: string };
  rows: unknown[];
};

const cache = new Map<string, { expires: number; data: Promise<Prices> }>();

async function loadPrinting(p: Printing): Promise<Prices> {
  const params = new URLSearchParams({
    game: p.game,
    tcgplayerId: String(p.product),
    limit: "200",
  });
  const catalog = await site<{ items: CatalogCard[]; nextCursor?: string }>(
    "cards",
    params,
  );
  const matches = catalog.items.filter(
    (c) =>
      c.tcgplayerId === p.product &&
      c.game === p.game &&
      c.printing.toLowerCase() === p.finish,
  );
  if (matches.length !== 1 || catalog.nextCursor) return [];
  const id = matches[0].id;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return [];
  // Card Broker Market uses the catalog card ID as its chart ID. Its own
  // React Router loader supplies the daily rows used by the collector chart.
  const response = await fetch(
    "https://www.cardbroker.app/market/card/" + id + ".data",
    {
      redirect: "error",
      signal: AbortSignal.timeout(6000),
    },
  );
  if (response.status === 404) return [];
  if (!response.ok || !response.body) throw Error("Market chart unavailable");
  const { value } = await decode(response.body, globalThis);
  const chart = (value as Record<string, { data?: ChartData }>)?.["routes/card"]
    ?.data;
  if (
    chart?.card?.id !== id ||
    chart.card.game !== p.game ||
    chart.card.printing.toLowerCase() !== p.finish ||
    !Array.isArray(chart.rows)
  )
    return [];
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.parse(end) - 89 * 86400000)
    .toISOString()
    .slice(0, 10);
  return chart.rows.flatMap((row): Prices => {
    if (!Array.isArray(row)) return [];
    const [day, market] = row;
    if (
      typeof day !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      day < start ||
      day > end ||
      typeof market !== "number" ||
      !Number.isFinite(market) ||
      market <= 0
    )
      return [];
    return [[day, Math.round(market * 100)]];
  });
}

async function cachedPrinting(p: Printing) {
  const item = cache.get(p.key);
  if (item && item.expires > Date.now()) return item.data;
  if (cache.size >= 4096) cache.delete(cache.keys().next().value!);
  const data = loadPrinting(p);
  cache.set(p.key, { expires: Date.now() + 3600000, data });
  try {
    return await data;
  } catch (error) {
    if (cache.get(p.key)?.data === data) cache.delete(p.key);
    throw error;
  }
}

export async function marketChartHistory(prints: Printing[]) {
  const history: Record<string, Prices> = {};
  let next = 0,
    errors = 0;
  async function read() {
    while (next < prints.length) {
      const p = prints[next++];
      try {
        const prices = await cachedPrinting(p);
        if (prices.length) history[p.key] = prices;
      } catch {
        errors++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, prints.length) }, read));
  if (errors)
    console.warn(
      "Cardbit Market chart read failures:",
      errors,
      "of",
      prints.length,
    );
  return history;
}
