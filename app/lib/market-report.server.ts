import type db from "../db.server";

type Db = typeof db;

// Days are counted in the store's time zone (Alabama).
export const REPORT_TIME_ZONE = "America/Chicago";

export type MarketDay = {
  day: string; // YYYY-MM-DD
  listed: number; // cards put up for sale that day (even if later cancelled or sold)
  sold: number; // cards sold that day
  soldValue: number; // total sale price of those cards
  soldWithCredit: number; // of those, bought with Vault Credit (no Shopify order)
  reversedSales: number; // of those, later reversed by staff
  trades: number; // trade offers accepted that day
  cardsTraded: number; // cards that changed hands in those trades
  reversedTrades: number; // of those, later reversed by staff
};

const isoDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: REPORT_TIME_ZONE });

// Vault Market activity per day for the last `days` days (today included), newest first.
export async function marketDailyReport(db: Db, shop: string, days = 30, now = new Date()): Promise<MarketDay[]> {
  const since = new Date(now.getTime() - (days + 1) * 86_400_000);
  const tz = REPORT_TIME_ZONE;
  const [listed, sold, trades] = await Promise.all([
    db.$queryRaw<{ day: string; n: bigint }[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, count(*) AS n
      FROM "Listing" WHERE shop = ${shop} AND "createdAt" >= ${since} GROUP BY 1`,
    db.$queryRaw<{ day: string; n: bigint; value: number | null; credit: bigint; reversed: bigint }[]>`
      SELECT to_char(("soldAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, count(*) AS n,
        sum(price)::float8 AS value,
        count(*) FILTER (WHERE "orderName" = 'Vault Credit') AS credit,
        count(*) FILTER (WHERE "payoutStatus" = 'CANCELLED') AS reversed
      FROM "Listing" WHERE shop = ${shop} AND status = 'SOLD' AND "soldAt" >= ${since} GROUP BY 1`,
    db.$queryRaw<{ day: string; n: bigint; cards: bigint; reversed: bigint }[]>`
      SELECT to_char((t."respondedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, count(DISTINCT t.id) AS n,
        count(i.id) AS cards,
        count(DISTINCT t.id) FILTER (WHERE t.status = 'REVERSED') AS reversed
      FROM "Trade" t LEFT JOIN "TradeItem" i ON i."tradeId" = t.id
      WHERE t.shop = ${shop} AND t.status IN ('ACCEPTED', 'REVERSED') AND t."respondedAt" >= ${since} GROUP BY 1`,
  ]);

  const out: MarketDay[] = [];
  for (let i = 0; i < days; i++) {
    const day = isoDay(new Date(now.getTime() - i * 86_400_000));
    if (out.some((d) => d.day === day)) continue;
    const l = listed.find((r) => r.day === day);
    const s = sold.find((r) => r.day === day);
    const t = trades.find((r) => r.day === day);
    out.push({
      day,
      listed: Number(l?.n ?? 0),
      sold: Number(s?.n ?? 0),
      soldValue: Math.round(Number(s?.value ?? 0) * 100) / 100,
      soldWithCredit: Number(s?.credit ?? 0),
      reversedSales: Number(s?.reversed ?? 0),
      trades: Number(t?.n ?? 0),
      cardsTraded: Number(t?.cards ?? 0),
      reversedTrades: Number(t?.reversed ?? 0),
    });
  }
  return out;
}

// Today's open market, for context next to the daily numbers.
export async function marketSnapshot(db: Db, shop: string) {
  const [activeListings, pendingOffers, traders] = await Promise.all([
    db.listing.count({ where: { shop, status: "ACTIVE" } }),
    db.trade.count({ where: { shop, status: "PENDING" } }),
    db.trader.count({ where: { shop } }),
  ]);
  return { activeListings, pendingOffers, traders };
}
