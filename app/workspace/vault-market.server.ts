import { Prisma, PrismaClient } from "@prisma/client";
import { marketChartHistory } from "./market-chart.server";
import { marketApproved } from "./market.server";

type MarketRow = { key: string; day: string; cents: number };
export type VaultSeries = Record<string, [string, number][]>;
let market: PrismaClient | undefined;

export function marketPrintings(keys: string[]) {
  return [...new Set(keys)].flatMap((key) => {
    const match = /^(\d{1,10})\|(en|ja)\|([^|]+)\|near mint$/.exec(key);
    if (!match || Number(match[1]) > 2147483647 || Number(match[1]) < 1)
      return [];
    return [
      {
        key,
        product: Number(match[1]),
        game: match[2] === "en" ? "pokemon" : "pokemon-japan",
        finish: match[3],
      },
    ];
  });
}

// The caller supplies only printing keys derived from the signed customer's held copies.
// This connection reads the same Card and PricePoint tables as the Card Broker Market chart.
export async function vaultMarketHistory(
  keys: string[],
): Promise<VaultSeries | null> {
  if (!marketApproved())
    return null;
  const wanted = marketPrintings(keys);
  if (!wanted.length) return {};
  if (!process.env.CARDBIT_MARKET_DATABASE_URL) return marketChartHistory(wanted);
  try {
    if (!market) {
      const url = new URL(process.env.CARDBIT_MARKET_DATABASE_URL);
      for (const [key, value] of Object.entries({
        connection_limit: "2",
        connect_timeout: "4",
        pool_timeout: "4",
        socket_timeout: "8",
      }))
        if (!url.searchParams.has(key)) url.searchParams.set(key, value);
      market = new PrismaClient({ datasourceUrl: url.toString() });
    }
    const rows = await market.$queryRaw<MarketRow[]>(Prisma.sql`
      WITH matches AS (
        SELECT w.key, c.id, count(*) OVER (PARTITION BY w.key) AS n
        FROM jsonb_to_recordset(${JSON.stringify(wanted)}::jsonb) AS w(key text, product int, game text, finish text)
        JOIN "Card" c ON c."tcgplayerId"=w.product AND c.game=w.game AND lower(c.printing)=w.finish
      )
      SELECT m.key, to_char(p.date,'YYYY-MM-DD') AS day, (p.market*100)::integer AS cents
      FROM matches m JOIN "PricePoint" p ON p."cardId"=m.id
      WHERE m.n=1 AND p.market>0 AND p.date BETWEEN (now() AT TIME ZONE 'UTC')::date-89 AND (now() AT TIME ZONE 'UTC')::date
      ORDER BY m.key, p.date`);
    const result: VaultSeries = {};
    for (const row of rows) (result[row.key] ??= []).push([row.day, row.cents]);
    return result;
  } catch {
    console.warn(
      "Cardbit Vault could not read the Card Broker Market history.",
    );
    return null;
  }
}
