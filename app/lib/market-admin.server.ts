// Staff views and tools for the Vault Marketplace admin page: headline numbers, the open market
// (listings and trade offers staff can take down), and a player lookup for customer service.
import type { PrismaClient } from "@prisma/client";
import { PoolError } from "./pool.server";
import { creditWallet } from "./credit.server";
import { marketDailyReport, marketSnapshot, type MarketDay } from "./market-report.server";

type Db = PrismaClient;

const DAY = 86_400_000;

const sum = (days: MarketDay[], key: keyof Omit<MarketDay, "day">) => days.reduce((n, d) => n + d[key], 0);

async function namesFor(db: Db, shop: string, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  const traders = wanted.length ? await db.trader.findMany({ where: { shop, customerId: { in: wanted } } }) : [];
  return (id: string | null) => traders.find((t) => t.customerId === id)?.tradeName ?? (id ? `#${id.split("/").pop()}` : "");
}

/** Headline numbers: this week against last week, what's open now, and who's most active this month. */
export async function marketOverview(db: Db, shop: string, now = new Date()) {
  const [daily, open, credit, fees, topSellers, topTraders] = await Promise.all([
    marketDailyReport(db, shop, 30, now),
    marketSnapshot(db, shop),
    db.creditTxn.aggregate({ where: { shop }, _sum: { amount: true } }),
    db.listing.findMany({
      where: { shop, status: "SOLD", soldAt: { gte: new Date(now.getTime() - 7 * DAY) }, NOT: { payoutStatus: "CANCELLED" } },
      select: { price: true, payoutAmount: true },
    }),
    db.listing.groupBy({
      by: ["sellerCustomerId"],
      where: { shop, status: "SOLD", soldAt: { gte: new Date(now.getTime() - 30 * DAY) }, NOT: { payoutStatus: "CANCELLED" } },
      _count: { _all: true },
      _sum: { price: true },
      orderBy: { _sum: { price: "desc" } },
      take: 5,
    }),
    db.$queryRaw<{ customerId: string; trades: bigint }[]>`
      SELECT c AS "customerId", count(*) AS trades FROM (
        SELECT "fromCustomerId" AS c FROM "Trade" WHERE shop = ${shop} AND status = 'ACCEPTED' AND "respondedAt" >= ${new Date(now.getTime() - 30 * DAY)}
        UNION ALL
        SELECT "toCustomerId" FROM "Trade" WHERE shop = ${shop} AND status = 'ACCEPTED' AND "respondedAt" >= ${new Date(now.getTime() - 30 * DAY)}
      ) x GROUP BY c ORDER BY trades DESC LIMIT 5`,
  ]);
  const name = await namesFor(db, shop, [...topSellers.map((s) => s.sellerCustomerId), ...topTraders.map((t) => t.customerId)]);
  // daily[0] is today so far; "this week" is the last 7 full-or-partial days, "last week" the 7 before.
  const thisWeek = daily.slice(0, 7);
  const lastWeek = daily.slice(7, 14);
  const week = (days: MarketDay[]) => ({
    listed: sum(days, "listed"),
    sold: sum(days, "sold"),
    soldValue: Math.round(sum(days, "soldValue") * 100) / 100,
    trades: sum(days, "trades"),
    cardsTraded: sum(days, "cardsTraded"),
  });
  return {
    daily,
    thisWeek: week(thisWeek),
    lastWeek: week(lastWeek),
    feesThisWeek: Math.round(fees.reduce((n, f) => n + Number(f.price) - Number(f.payoutAmount ?? f.price), 0) * 100) / 100,
    open,
    outstandingCredit: Number(credit._sum.amount ?? 0),
    topSellers: topSellers.map((s) => ({ name: name(s.sellerCustomerId), customerId: s.sellerCustomerId, sold: s._count._all, value: Number(s._sum.price ?? 0) })),
    topTraders: topTraders.map((t) => ({ name: name(t.customerId), customerId: t.customerId, trades: Number(t.trades) })),
  };
}

/** Cards for sale right now (and ones a buyer is checking out), newest first. */
export async function openListings(db: Db, shop: string, q = "", take = 200) {
  const listings = await db.listing.findMany({
    where: { shop, status: { in: ["ACTIVE", "CHECKOUT"] }, ...(q ? { pull: { slot: { card: { title: { contains: q, mode: "insensitive" } } } } } : {}) },
    include: { pull: { include: { slot: { include: { card: true } } } } },
    orderBy: { createdAt: "desc" },
    take,
  });
  const name = await namesFor(db, shop, listings.flatMap((l) => [l.sellerCustomerId, l.buyerCustomerId]));
  return listings.map((l) => ({
    id: l.id,
    card: l.pull.slot.card.title,
    image: l.pull.slot.card.imageUrl,
    seller: name(l.sellerCustomerId),
    sellerId: l.sellerCustomerId,
    price: Number(l.price),
    status: l.status,
    buyer: name(l.buyerCustomerId),
    listedAt: l.createdAt,
    checkoutExpiresAt: l.checkoutExpiresAt,
  }));
}

/** Trade offers waiting on an answer. */
export async function openOffers(db: Db, shop: string, take = 200) {
  const trades = await db.trade.findMany({
    where: { shop, status: "PENDING" },
    include: { items: { include: { pull: { include: { slot: { include: { card: true } } } } } } },
    orderBy: { createdAt: "desc" },
    take,
  });
  const name = await namesFor(db, shop, trades.flatMap((t) => [t.fromCustomerId, t.toCustomerId]));
  return trades.map((t) => ({
    id: t.id,
    from: name(t.fromCustomerId),
    to: name(t.toCustomerId),
    gives: t.items.filter((i) => i.side === "GIVE").map((i) => i.pull.slot.card.title),
    gets: t.items.filter((i) => i.side === "GET").map((i) => i.pull.slot.card.title),
    note: t.note,
    sentAt: t.createdAt,
    expiresAt: t.expiresAt,
  }));
}

/** Staff take a card off the market (e.g. a mistaken or abusive listing). A card mid-checkout can't be pulled. */
export async function staffCancelListing(db: Db, shop: string, listingId: string) {
  const { count } = await db.listing.updateMany({ where: { id: listingId, shop, status: "ACTIVE" }, data: { status: "CANCELLED" } });
  if (!count) throw new PoolError("That listing is no longer for sale (a buyer may be checking out).");
}

/** Staff withdraw a pending trade offer for the player who sent it. */
export async function staffCancelOffer(db: Db, shop: string, tradeId: string) {
  const { count } = await db.trade.updateMany({
    where: { id: tradeId, shop, status: "PENDING" },
    data: { status: "CANCELLED", respondedAt: new Date() },
  });
  if (!count) throw new PoolError("That offer is no longer open.");
}

/** Find a player by trade name first, otherwise hand back null so the caller can try email / customer ID. */
export async function traderByName(db: Db, shop: string, query: string) {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  return (
    (await db.trader.findUnique({ where: { shop_nameKey: { shop, nameKey: key } } })) ??
    (await db.trader.findFirst({ where: { shop, nameKey: { contains: key } }, orderBy: { createdAt: "asc" } }))
  );
}

/** Everything customer service needs about one player's Vault Market use. */
export async function playerProfile(db: Db, shop: string, customerId: string, now = new Date()) {
  const [trader, wallet, vaultCards, openToTrade, listings, purchases, trades] = await Promise.all([
    db.trader.findUnique({ where: { shop_customerId: { shop, customerId } } }),
    creditWallet(db, shop, customerId),
    db.pull.count({ where: { shop, customerId, status: "REVEALED", shipRequestId: null } }),
    db.pull.count({ where: { shop, customerId, status: "REVEALED", shipRequestId: null, openToTrade: true } }),
    db.listing.findMany({
      where: { shop, sellerCustomerId: customerId },
      include: { pull: { include: { slot: { include: { card: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.listing.findMany({
      where: { shop, buyerCustomerId: customerId, status: "SOLD" },
      include: { pull: { include: { slot: { include: { card: true } } } } },
      orderBy: { soldAt: "desc" },
      take: 50,
    }),
    db.trade.findMany({
      where: { shop, OR: [{ fromCustomerId: customerId }, { toCustomerId: customerId }] },
      include: { items: { include: { pull: { include: { slot: { include: { card: true } } } } } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  const name = await namesFor(db, shop, [
    ...purchases.map((p) => p.sellerCustomerId),
    ...listings.map((l) => l.buyerCustomerId),
    ...trades.flatMap((t) => [t.fromCustomerId, t.toCustomerId]),
  ]);
  return {
    customerId,
    customerNumber: customerId.split("/").pop() ?? customerId,
    tradeName: trader?.tradeName ?? null,
    joinedAt: trader?.createdAt ?? null,
    termsVersion: trader?.termsVersion ?? null,
    termsAcceptedAt: trader?.termsAcceptedAt ?? null,
    showCollection: trader?.showCollection ?? false,
    vaultCards,
    openToTrade,
    wallet,
    listings: listings.map((l) => ({
      id: l.id,
      card: l.pull.slot.card.title,
      price: Number(l.price),
      status: l.status,
      payoutStatus: l.payoutStatus,
      buyer: name(l.buyerCustomerId),
      at: l.soldAt ?? l.createdAt,
    })),
    purchases: purchases.map((p) => ({
      id: p.id,
      card: p.pull.slot.card.title,
      price: Number(p.price),
      seller: name(p.sellerCustomerId),
      paidWith: p.orderName === "Vault Credit" ? "Vault Credit" : p.orderName ?? "",
      reversed: p.payoutStatus === "CANCELLED",
      at: p.soldAt,
    })),
    trades: trades.map((t) => {
      const sent = t.fromCustomerId === customerId;
      const mine = t.items.filter((i) => i.side === (sent ? "GIVE" : "GET")).map((i) => i.pull.slot.card.title);
      const theirs = t.items.filter((i) => i.side === (sent ? "GET" : "GIVE")).map((i) => i.pull.slot.card.title);
      return {
        id: t.id,
        with: name(sent ? t.toCustomerId : t.fromCustomerId),
        sent,
        status: t.status,
        gave: mine,
        got: theirs,
        at: t.respondedAt ?? t.createdAt,
        expired: t.status === "PENDING" && t.expiresAt < now,
      };
    }),
  };
}
