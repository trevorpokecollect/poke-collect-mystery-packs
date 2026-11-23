import { UNSAFE_decodeViaTurboStream as decode } from "react-router";
import { site } from "./sources.server";

type Printing = { key: string; product: number; game: string; finish: string };
type Prices = [string, number][];
type CatalogCard = {
  id: string;
  game: string;
  printing: string;
  tcgplayerId: number;
  name: string;
  number: string | null;
  set: { name: string } | null;
};
type ChartData = {
  card: { id: string; game: string; printing: string };
  rows: unknown[];
};

const cache = new Map<string, { expires: number; data: Promise<Prices> }>();

const validId = (id: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(id);

function tcgImageId(image: string | null) {
  if (!image) return null;
  try {
    const url = new URL(image);
    if (
      url.hostname === "tcgplayer-cdn.tcgplayer.com" ||
      url.hostname === "product-images.tcgplayer.com"
    )
      return url.pathname.match(
        /\/(\d+)(?:_in_\d+x\d+)?\.(?:jpg|png|webp)$/i,
      )?.[1];
  } catch {
    /* Unrecognized image source. */
  }
  return null;
}

async function marketRoute<T>(path: string, route: string): Promise<T | null> {
  const url = new URL(path, "https://www.cardbroker.app/market/");
  url.pathname += ".data";
  const response = await fetch(url.toString(), {
    redirect: "error",
    signal: AbortSignal.timeout(6000),
  });
  if (response.status === 404) return null;
  if (!response.ok || !response.body) throw Error("Market chart unavailable");
  const { value } = await decode(response.body, globalThis);
  return (
    (value as Record<string, { data?: T }>)?.["routes/" + route]?.data ?? null
  );
}

type MarketSet = { id: string; name: string; game: string };
type SetPrinting = {
  number: string | null;
  printing: string;
  imageUrl: string | null;
  market: string | null;
};

export const setPrintingKey = (
  set: string,
  product: string,
  number: string,
  finish: string,
) => JSON.stringify([set, product, number, finish.trim().toLowerCase()]);

// Read the same set index shown on Card Broker Market, once per missing set.
export async function japaneseSetMarkets(names: Set<string>) {
  const prices = new Map<string, string | null>();
  if (!names.size) return prices;
  const index = await marketRoute<{ game: string; sets: MarketSet[] }>(
    "sets?game=pokemon-japan",
    "sets",
  );
  if (index?.game !== "pokemon-japan")
    throw Error("Japanese Market set index unavailable.");
  for (const name of names) {
    const matches = index.sets.filter((s) => s.name === name && validId(s.id));
    if (matches.length !== 1) continue;
    const { id } = matches[0];
    const detail = await marketRoute<{ set: MarketSet; cards: SetPrinting[] }>(
      "sets/" + id,
      "set",
    );
    if (
      detail?.set.id !== id ||
      detail.set.game !== "pokemon-japan" ||
      detail.set.name !== name
    )
      continue;
    for (const card of detail.cards) {
      const product = tcgImageId(card.imageUrl);
      if (!product || !card.number || !card.printing) continue;
      const key = setPrintingKey(name, product, card.number, card.printing);
      prices.set(key, prices.has(key) ? null : card.market);
    }
  }
  return prices;
}

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
  const card = matches[0];
  if (!validId(card.id)) return [];
  let id = card.id;
  let chart = await marketRoute<ChartData>("card/" + id, "card");
  // Some historical Market imports used the original catalog's IDs. Resolve
  // those copies by exact TCGplayer image ID, set, number, name and finish.
  if (!chart && card.number && card.set && card.name) {
    const query = new URLSearchParams({
      q:
        card.name.replace(/\s*-?\s*#?[a-z]*\d+\/[^ ]+$/i, "").trim() +
        " " +
        card.number,
    });
    const search = await marketRoute<{
      cards: (CatalogCard & { imageUrl: string | null })[];
    }>("search?" + query, "search");
    const alternatives = search?.cards?.filter(
      (c) =>
        validId(c.id) &&
        c.number === card.number &&
        c.name === card.name &&
        c.set?.name === card.set?.name &&
        c.printing.toLowerCase() === p.finish &&
        tcgImageId(c.imageUrl) === String(p.product),
    );
    if (alternatives?.length !== 1 || alternatives[0].id === id) return [];
    id = alternatives[0].id;
    chart = await marketRoute<ChartData>("card/" + id, "card");
  }
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
