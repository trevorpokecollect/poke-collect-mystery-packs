// Vault marketplace: players trade vault cards with each other, or sell them to each other for
// Vault Credit (this app's own balance, never Shopify store credit, so it can't buy packs). The store is never the buyer. Cards stay on our shelf the whole time; a trade or
// sale only changes which customer owns the pull. Off until the merchant turns it on.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { Prisma, type PrismaClient } from "@prisma/client";
import { gql } from "./orders.server";
import { PoolError } from "./pool.server";
import { klaviyoEvent, shopCurrency } from "./vault.server";
import { addCredit, spendCredit } from "./credit.server";

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

/** A card can change owners once its pack order (or its last sale) is this old: refund cooling-off. */
export const TRADE_WAIT_DAYS = 0;
/** Offers lapse after this long without an answer. */
export const OFFER_DAYS = 7;
/** A buyer's unpaid invoice holds the card this long. */
export const CHECKOUT_MINUTES = 60;
/** The seller's Vault Credit is held this long after a card-paid sale (buyer chargeback window). */
export const PAYOUT_HOLD_DAYS = 0;
export const MAX_SIDE_CARDS = 10;
export const MAX_OPEN_OFFERS = 10;
export const MIN_PRICE = 1;
export const MAX_PRICE = 5000;
export const MARKET_ATTRIBUTE = "_market_listing";
export const MARKET_TAG = "vault-marketplace";

/** Offer notes come from a fixed list: no free text, so no contact swapping or off-site deals. */
export const OFFER_NOTES = [
  "Fair Trade?",
  "Need This For My Set",
  "Open To Counter Offers",
  "Thanks For Looking",
] as const;

export const METRICS = {
  offerReceived: "Trade Offer Received",
  offerAccepted: "Trade Offer Accepted",
  offerDeclined: "Trade Offer Declined",
  cardSold: "Vault Card Sold",
  payout: "Vault Sale Payout",
  wishAvailable: "Wishlist Card Available",
};

const DAY = 86_400_000;
const LIVE_SHIP = ["PENDING", "PAID"];

export async function marketSettings(db: Db | Tx, shop: string) {
  const row = await db.marketSettings.findUnique({ where: { shop } });
  return {
    enabled: row?.enabled ?? false,
    sellingEnabled: (row?.enabled ?? false) && (row?.sellingEnabled ?? false),
    feePercent: Number(row?.feePercent ?? 10),
    creditCollections: row?.creditCollectionIds.length ?? 0,
    accessTag: row?.accessTag ?? null,
  };
}

export async function updateMarketSettings(
  db: Db,
  shop: string,
  input: { enabled?: boolean; sellingEnabled?: boolean; feePercent?: number; creditCollectionIds?: string[]; creditCombines?: boolean; accessTag?: string | null },
) {
  if (input.feePercent !== undefined && !(input.feePercent >= 0 && input.feePercent <= 50)) {
    throw new PoolError("The fee must be between 0% and 50%.");
  }
  return db.marketSettings.upsert({ where: { shop }, create: { shop, ...input }, update: input });
}

/**
 * Whether this customer can use Vault Market: it's on, and during a soft launch they carry the
 * access tag in Shopify. Staff can test before everyone sees it.
 */
export async function hasMarketAccess(db: Db, admin: AdminApiContext | undefined, shop: string, customerId: string | null | undefined) {
  const settings = await marketSettings(db, shop);
  if (!settings.enabled || !customerId) return false;
  if (!settings.accessTag) return true;
  if (!admin) return false;
  const data = await gql(admin, `#graphql
    query MarketAccess($id: ID!) { customer(id: $id) { tags } }`, { id: customerId }).catch(() => null);
  const tags = ((data?.customer?.tags as string[] | undefined) ?? []).map((t) => t.toLowerCase());
  return tags.includes(settings.accessTag.toLowerCase());
}

async function requireEnabled(db: Db | Tx, shop: string, selling = false) {
  const settings = await marketSettings(db, shop);
  if (!settings.enabled) throw new PoolError("The Vault Marketplace isn't open yet.");
  if (selling && !settings.sellingEnabled) throw new PoolError("Selling isn't open yet.");
  return settings;
}

// ---------- Trade names ----------

export async function traderFor(db: Db | Tx, shop: string, customerId: string) {
  return db.trader.findUnique({ where: { shop_customerId: { shop, customerId } } });
}

export async function setTradeName(db: Db, shop: string, customerId: string, raw: string) {
  const tradeName = raw.trim().replace(/\s+/g, " ");
  if (!/^[A-Za-z0-9 _-]{3,20}$/.test(tradeName)) {
    throw new PoolError("Trade names are 3 to 20 letters, numbers, spaces, dashes or underscores.");
  }
  if (/@|poke-?collect|admin|staff|support/i.test(tradeName)) throw new PoolError("Please pick a different trade name.");
  const nameKey = tradeName.toLowerCase();
  const taken = await db.trader.findUnique({ where: { shop_nameKey: { shop, nameKey } } });
  if (taken && taken.customerId !== customerId) throw new PoolError("That trade name is taken.");
  return db.trader.upsert({
    where: { shop_customerId: { shop, customerId } },
    create: { shop, customerId, tradeName, nameKey },
    update: { tradeName, nameKey },
  });
}

async function requireTrader(db: Db | Tx, shop: string, customerId: string) {
  const trader = await traderFor(db, shop, customerId);
  if (!trader) throw new PoolError("Pick a trade name first.");
  return trader;
}

// ---------- Which cards can change owners ----------

const marketInclude = {
  slot: { include: { card: true } },
  series: { select: { title: true } },
  shipRequest: { select: { status: true } },
  listings: { where: { status: { in: ["ACTIVE", "CHECKOUT", "SOLD"] } }, orderBy: { createdAt: "desc" } },
  tradeItems: { where: { trade: { status: "PENDING" } }, include: { trade: { select: { id: true, fromCustomerId: true } } } },
} satisfies Prisma.PullInclude;

type MarketPull = Prisma.PullGetPayload<{ include: typeof marketInclude }>;

/** Why this card can't be traded or sold right now, or null if it can. */
export function lockReason(pull: MarketPull, vaultOrder: boolean, now = new Date()): string | null {
  if (pull.status !== "REVEALED" || !vaultOrder) return "Not In Your Vault";
  if (pull.shipRequestId && LIVE_SHIP.includes(pull.shipRequest?.status ?? "")) return "Shipping";
  if (pull.refundFlaggedAt) return "Under Review";
  if (pull.listings.some((l) => l.status === "CHECKOUT")) return "Being Bought";
  const lastSale = pull.listings.find((l) => l.status === "SOLD")?.soldAt;
  const since = Math.max(pull.createdAt.getTime(), lastSale?.getTime() ?? 0);
  if (now.getTime() - since < TRADE_WAIT_DAYS * DAY) {
    const days = Math.ceil((since + TRADE_WAIT_DAYS * DAY - now.getTime()) / DAY);
    return `Tradable In ${days} Day${days === 1 ? "" : "s"}`;
  }
  return null;
}

async function vaultOrderIds(db: Db | Tx, orderIds: string[]) {
  const rows = await db.packOrder.findMany({ where: { orderId: { in: [...new Set(orderIds)] }, vault: true }, select: { orderId: true } });
  return new Set(rows.map((r) => r.orderId));
}

function cardView(pull: MarketPull) {
  const card = pull.slot.card;
  return { pullId: pull.id, cardKey: card.variantId, title: card.title, imageUrl: card.imageUrl, series: pull.series.title };
}

/** The viewer's vault cards with their marketplace state. */
export async function myMarketCards(db: Db, shop: string, customerId: string, now = new Date()) {
  const pulls = await db.pull.findMany({
    where: { shop, customerId, status: "REVEALED" },
    include: marketInclude,
    orderBy: { createdAt: "desc" },
  });
  const vault = await vaultOrderIds(db, pulls.map((p) => p.orderId));
  const wanted = await wishers(db, shop, pulls.map((p) => p.slot.card.variantId));
  return pulls
    .filter((p) => vault.has(p.orderId) && !(p.shipRequestId && LIVE_SHIP.includes(p.shipRequest?.status ?? "")))
    .map((p) => {
      const listing = p.listings.find((l) => l.status === "ACTIVE" || l.status === "CHECKOUT");
      return {
        ...cardView(p),
        wantedBy: (wanted.get(p.slot.card.variantId) ?? []).filter((id) => id !== customerId).length,
        openToTrade: p.openToTrade,
        locked: lockReason(p, true, now),
        listing: listing ? { id: listing.id, price: Number(listing.price), status: listing.status } : null,
        inOffer: p.tradeItems.some((i) => i.side === "GIVE" && i.trade.fromCustomerId === customerId),
      };
    });
}

/** Cards other players have put on the Trade Board (open to trade and/or for sale). */
export async function boardCards(db: Db, shop: string, viewerId: string, { q = "", now = new Date() } = {}) {
  const settings = await marketSettings(db, shop);
  const pulls = await db.pull.findMany({
    where: {
      shop,
      status: "REVEALED",
      customerId: { not: viewerId },
      OR: [{ openToTrade: true }, ...(settings.sellingEnabled ? [{ listings: { some: { status: "ACTIVE" as const } } }] : [])],
      ...(q ? { slot: { card: { title: { contains: q, mode: "insensitive" as const } } } } : {}),
    },
    include: marketInclude,
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const vault = await vaultOrderIds(db, pulls.map((p) => p.orderId));
  const tradable = pulls.filter((p) => p.customerId && vault.has(p.orderId) && !lockReason(p, true, now));
  const traders = await db.trader.findMany({ where: { shop, customerId: { in: [...new Set(tradable.map((p) => p.customerId!))] } } });
  const names = new Map(traders.map((t) => [t.customerId, t.tradeName]));
  const wanted = await wishers(db, shop, tradable.map((p) => p.slot.card.variantId));
  return tradable
    .filter((p) => names.has(p.customerId!))
    .map((p) => {
      const listing = settings.sellingEnabled ? p.listings.find((l) => l.status === "ACTIVE") : undefined;
      return {
        ...cardView(p),
        wantedBy: (wanted.get(p.slot.card.variantId) ?? []).filter((id) => id !== p.customerId).length,
        trader: names.get(p.customerId!)!,
        openToTrade: p.openToTrade,
        listing: listing ? { id: listing.id, price: Number(listing.price) } : null,
      };
    });
}

/** Locks the given pulls (row locks) and returns them with what's needed to re-check them. */
async function lockPulls(tx: Tx, ids: string[]) {
  if (ids.length === 0) return [];
  await tx.$queryRaw`SELECT id FROM "Pull" WHERE id IN (${Prisma.join([...ids].sort())}) ORDER BY id FOR UPDATE`;
  const pulls = await tx.pull.findMany({ where: { id: { in: ids } }, include: marketInclude });
  const vault = await vaultOrderIds(tx, pulls.map((p) => p.orderId));
  return pulls.map((p) => ({ pull: p, vault: vault.has(p.orderId) }));
}

export async function setOpenToTrade(db: Db, shop: string, customerId: string, pullId: string, on: boolean) {
  await requireEnabled(db, shop);
  if (on) await requireTrader(db, shop, customerId);
  const pull = await db.pull.findFirst({ where: { id: pullId, shop, customerId, status: "REVEALED" } });
  if (!pull) throw new PoolError("That card isn't in your vault.");
  await db.pull.update({ where: { id: pullId }, data: { openToTrade: on } });
  if (!on) {
    // Offers asking for this card no longer make sense.
    await cancelPendingTrades(db, [pullId], "GET");
  }
}

// ---------- Trades ----------

async function cancelPendingTrades(db: Db | Tx, pullIds: string[], side?: "GIVE" | "GET", exceptTradeId?: string) {
  if (pullIds.length === 0) return 0;
  const { count } = await db.trade.updateMany({
    where: {
      status: "PENDING",
      ...(exceptTradeId ? { id: { not: exceptTradeId } } : {}),
      items: { some: { pullId: { in: pullIds }, ...(side ? { side } : {}) } },
    },
    data: { status: "CANCELLED", respondedAt: new Date() },
  });
  return count;
}

export interface OfferInput {
  give: string[];
  get: string[];
  note?: string | null;
  counterOfId?: string | null;
}

export async function createOffer(db: Db, shop: string, fromCustomerId: string, input: OfferInput, now = new Date()) {
  await requireEnabled(db, shop);
  await requireTrader(db, shop, fromCustomerId);
  const give = [...new Set(input.give)];
  const get = [...new Set(input.get)];
  if (give.length === 0 || get.length === 0) throw new PoolError("Pick at least one of your cards and one of theirs.");
  if (give.length > MAX_SIDE_CARDS || get.length > MAX_SIDE_CARDS) throw new PoolError(`Up to ${MAX_SIDE_CARDS} cards on each side.`);
  const note = input.note ? input.note : null;
  if (note && !(OFFER_NOTES as readonly string[]).includes(note)) throw new PoolError("Pick a note from the list.");

  return db.$transaction(async (tx) => {
    const open = await tx.trade.count({ where: { shop, fromCustomerId, status: "PENDING" } });
    if (open >= MAX_OPEN_OFFERS) throw new PoolError(`You can have ${MAX_OPEN_OFFERS} open offers at a time.`);

    const locked = await lockPulls(tx, [...give, ...get]);
    const byId = new Map(locked.map((l) => [l.pull.id, l]));
    for (const id of give) {
      const l = byId.get(id);
      if (!l || l.pull.shop !== shop || l.pull.customerId !== fromCustomerId) throw new PoolError("One of your cards isn't in your vault anymore.");
      const reason = lockReason(l.pull, l.vault, now);
      if (reason) throw new PoolError(`${l.pull.slot.card.title} can't be traded right now (${reason}).`);
      if (l.pull.tradeItems.some((i) => i.side === "GIVE")) throw new PoolError(`${l.pull.slot.card.title} is already in another offer.`);
    }
    const owners = new Set(get.map((id) => byId.get(id)?.pull.customerId));
    const toCustomerId = owners.size === 1 ? [...owners][0] : null;
    if (!toCustomerId || toCustomerId === fromCustomerId) throw new PoolError("Pick cards from one other player.");
    for (const id of get) {
      const l = byId.get(id)!;
      const counteringThem = input.counterOfId && l.pull.tradeItems.some((i) => i.trade.id === input.counterOfId);
      if (l.pull.shop !== shop || (!l.pull.openToTrade && !counteringThem) || lockReason(l.pull, l.vault, now)) {
        throw new PoolError(`${l.pull.slot.card.title} isn't open to trade anymore.`);
      }
    }
    if (!(await traderFor(tx, shop, toCustomerId))) throw new PoolError("That player isn't trading right now.");

    if (input.counterOfId) {
      const original = await tx.trade.findFirst({ where: { id: input.counterOfId, shop, toCustomerId: fromCustomerId, status: "PENDING" } });
      if (!original) throw new PoolError("That offer is no longer open.");
      await tx.trade.update({ where: { id: original.id }, data: { status: "DECLINED", respondedAt: now } });
    }

    return tx.trade.create({
      data: {
        shop,
        fromCustomerId,
        toCustomerId,
        note,
        counterOfId: input.counterOfId ?? null,
        expiresAt: new Date(now.getTime() + OFFER_DAYS * DAY),
        items: { create: [...give.map((pullId) => ({ pullId, side: "GIVE" })), ...get.map((pullId) => ({ pullId, side: "GET" }))] },
      },
      include: { items: true },
    });
  });
}

/** Moves pulls to a new owner inside a transaction and logs it. Clears their listings and offers. */
async function transfer(
  tx: Tx,
  shop: string,
  moves: { pullId: string; from: string; to: string }[],
  reason: "TRADE" | "SALE" | "REVERSAL",
  ref: { tradeId?: string; listingId?: string },
  now: Date,
) {
  for (const m of moves) {
    await tx.pull.update({ where: { id: m.pullId }, data: { customerId: m.to, transferredAt: now, openToTrade: false } });
  }
  await tx.pullTransfer.createMany({
    data: moves.map((m) => ({ shop, pullId: m.pullId, fromCustomerId: m.from, toCustomerId: m.to, reason, ...ref })),
  });
  const ids = moves.map((m) => m.pullId);
  await tx.listing.updateMany({ where: { pullId: { in: ids }, status: "ACTIVE" }, data: { status: "CANCELLED" } });
  await cancelPendingTrades(tx, ids, undefined, ref.tradeId);
}

export async function respondToOffer(db: Db, shop: string, customerId: string, tradeId: string, answer: "accept" | "decline", now = new Date()) {
  await requireEnabled(db, shop);
  return db.$transaction(async (tx) => {
    const trade = await tx.trade.findFirst({ where: { id: tradeId, shop, toCustomerId: customerId }, include: { items: true } });
    if (!trade || trade.status !== "PENDING" || trade.expiresAt < now) throw new PoolError("That offer is no longer open.");
    if (answer === "decline") {
      return tx.trade.update({ where: { id: trade.id }, data: { status: "DECLINED", respondedAt: now } });
    }
    const locked = await lockPulls(tx, trade.items.map((i) => i.pullId));
    const byId = new Map(locked.map((l) => [l.pull.id, l]));
    for (const item of trade.items) {
      const l = byId.get(item.pullId)!;
      const owner = item.side === "GIVE" ? trade.fromCustomerId : trade.toCustomerId;
      const busy = l.pull.listings.some((x) => x.status === "CHECKOUT");
      if (l.pull.customerId !== owner || lockReason(l.pull, l.vault, now) || busy) {
        await tx.trade.update({ where: { id: trade.id }, data: { status: "CANCELLED", respondedAt: now } });
        throw new PoolError("A card in this offer isn't available anymore, so the offer was cancelled.");
      }
    }
    await transfer(
      tx,
      shop,
      trade.items.map((i) =>
        i.side === "GIVE"
          ? { pullId: i.pullId, from: trade.fromCustomerId, to: trade.toCustomerId }
          : { pullId: i.pullId, from: trade.toCustomerId, to: trade.fromCustomerId },
      ),
      "TRADE",
      { tradeId: trade.id },
      now,
    );
    return tx.trade.update({ where: { id: trade.id }, data: { status: "ACCEPTED", respondedAt: now } });
  });
}

export async function cancelOffer(db: Db, shop: string, customerId: string, tradeId: string) {
  const { count } = await db.trade.updateMany({
    where: { id: tradeId, shop, fromCustomerId: customerId, status: "PENDING" },
    data: { status: "CANCELLED", respondedAt: new Date() },
  });
  if (!count) throw new PoolError("That offer is no longer open.");
}

/** The viewer's open offers, both directions, with card details and trade names. */
export async function myOffers(db: Db, shop: string, customerId: string) {
  const trades = await db.trade.findMany({
    where: { shop, status: "PENDING", OR: [{ fromCustomerId: customerId }, { toCustomerId: customerId }] },
    include: { items: { include: { pull: { include: { slot: { include: { card: true } }, series: { select: { title: true } } } } } } },
    orderBy: { createdAt: "desc" },
  });
  const traders = await db.trader.findMany({
    where: { shop, customerId: { in: [...new Set(trades.flatMap((t) => [t.fromCustomerId, t.toCustomerId]))] } },
  });
  const names = new Map(traders.map((t) => [t.customerId, t.tradeName]));
  const view = (i: (typeof trades)[number]["items"][number]) => ({
    pullId: i.pullId,
    title: i.pull.slot.card.title,
    imageUrl: i.pull.slot.card.imageUrl,
    series: i.pull.series.title,
  });
  return trades.map((t) => {
    const incoming = t.toCustomerId === customerId;
    const give = t.items.filter((i) => i.side === "GIVE").map(view);
    const get = t.items.filter((i) => i.side === "GET").map(view);
    return {
      id: t.id,
      incoming,
      with: names.get(incoming ? t.fromCustomerId : t.toCustomerId) ?? "A Player",
      note: t.note,
      expiresAt: t.expiresAt,
      // From the viewer's side: what they give and what they get.
      youGive: incoming ? get : give,
      youGet: incoming ? give : get,
    };
  });
}

/** Staff: undoes an accepted trade if every card is still with its new owner and in the vault. */
export async function reverseTrade(db: Db, shop: string, tradeId: string, now = new Date()) {
  return db.$transaction(async (tx) => {
    const trade = await tx.trade.findFirst({ where: { id: tradeId, shop }, include: { items: true } });
    if (!trade || trade.status !== "ACCEPTED") throw new PoolError("Only an accepted trade can be reversed.");
    const locked = await lockPulls(tx, trade.items.map((i) => i.pullId));
    const byId = new Map(locked.map((l) => [l.pull.id, l]));
    const moves = trade.items.map((i) => {
      const l = byId.get(i.pullId)!;
      const holder = i.side === "GIVE" ? trade.toCustomerId : trade.fromCustomerId;
      const back = i.side === "GIVE" ? trade.fromCustomerId : trade.toCustomerId;
      const shipping = l.pull.shipRequestId && LIVE_SHIP.includes(l.pull.shipRequest?.status ?? "");
      if (l.pull.customerId !== holder || l.pull.status !== "REVEALED" || shipping || l.pull.listings.some((x) => x.status === "CHECKOUT")) {
        throw new PoolError(`${l.pull.slot.card.title} has moved on since this trade (shipped, sold or traded again).`);
      }
      return { pullId: i.pullId, from: holder, to: back };
    });
    await transfer(tx, shop, moves, "REVERSAL", { tradeId: trade.id }, now);
    return tx.trade.update({ where: { id: trade.id }, data: { status: "REVERSED", reversedAt: now } });
  });
}

// ---------- Selling to other players ----------

export async function createListing(db: Db, shop: string, sellerCustomerId: string, pullId: string, rawPrice: number, now = new Date()) {
  await requireEnabled(db, shop, true);
  await requireTrader(db, shop, sellerCustomerId);
  const price = Math.round(rawPrice * 100) / 100;
  if (!(price >= MIN_PRICE && price <= MAX_PRICE)) throw new PoolError(`Prices are $${MIN_PRICE} to $${MAX_PRICE}.`);
  return db.$transaction(async (tx) => {
    const [l] = await lockPulls(tx, [pullId]);
    if (!l || l.pull.shop !== shop || l.pull.customerId !== sellerCustomerId) throw new PoolError("That card isn't in your vault.");
    const reason = lockReason(l.pull, l.vault, now);
    if (reason) throw new PoolError(`That card can't be sold right now (${reason}).`);
    if (l.pull.listings.some((x) => x.status === "ACTIVE")) {
      return tx.listing.updateMany({ where: { pullId, status: "ACTIVE" }, data: { price } }).then(() => tx.listing.findFirstOrThrow({ where: { pullId, status: "ACTIVE" } }));
    }
    return tx.listing.create({ data: { shop, pullId, sellerCustomerId, price } });
  });
}

export async function cancelListing(db: Db, shop: string, sellerCustomerId: string, listingId: string) {
  const { count } = await db.listing.updateMany({
    where: { id: listingId, shop, sellerCustomerId, status: "ACTIVE" },
    data: { status: "CANCELLED" },
  });
  if (!count) throw new PoolError("That listing can't be changed right now.");
}

/**
 * The buyer clicks Buy: the card is held for them and they get a Shopify invoice for the price.
 * The card moves to their vault when the invoice is paid (orders/paid).
 */
export async function startPurchase(db: Db, admin: AdminApiContext, shop: string, buyerCustomerId: string, listingId: string, now = new Date()) {
  await requireEnabled(db, shop, true);
  const held = await db.$transaction(async (tx) => {
    const listing = await tx.listing.findFirst({ where: { id: listingId, shop } });
    if (!listing) throw new PoolError("That card isn't for sale anymore.");
    if (listing.sellerCustomerId === buyerCustomerId) throw new PoolError("That's your own card.");
    if (listing.status === "CHECKOUT" && listing.buyerCustomerId === buyerCustomerId && listing.invoiceUrl) return { reuse: listing.invoiceUrl, listing, title: "" };
    if (listing.status !== "ACTIVE") throw new PoolError("Someone else is buying that card right now.");
    const [l] = await lockPulls(tx, [listing.pullId]);
    if (!l || l.pull.customerId !== listing.sellerCustomerId || lockReason(l.pull, l.vault, now)) {
      await tx.listing.update({ where: { id: listing.id }, data: { status: "CANCELLED" } });
      throw new PoolError("That card isn't for sale anymore.");
    }
    const claimed = await tx.listing.updateMany({
      where: { id: listing.id, status: "ACTIVE" },
      data: { status: "CHECKOUT", buyerCustomerId, checkoutExpiresAt: new Date(now.getTime() + CHECKOUT_MINUTES * 60_000) },
    });
    if (!claimed.count) throw new PoolError("Someone else is buying that card right now.");
    return { reuse: null, listing, title: l.pull.slot.card.title };
  });
  if (held.reuse) return { invoiceUrl: held.reuse };

  try {
    const seller = await traderFor(db, shop, held.listing.sellerCustomerId);
    const currencyCode = await shopCurrency(admin);
    const data = await gql(
      admin,
      `#graphql
        mutation MarketDraft($input: DraftOrderInput!) {
          draftOrderCreate(input: $input) { draftOrder { id invoiceUrl } userErrors { field message } }
        }`,
      {
        input: {
          purchasingEntity: { customerId: buyerCustomerId },
          tags: [MARKET_TAG],
          note: `Vault Marketplace: ${held.title} from ${seller?.tradeName ?? "a player"}. The card moves to the buyer's vault; nothing ships.`,
          customAttributes: [{ key: MARKET_ATTRIBUTE, value: held.listing.id }],
          lineItems: [
            {
              title: `Vault Card: ${held.title}`,
              quantity: 1,
              originalUnitPriceWithCurrency: { amount: Number(held.listing.price).toFixed(2), currencyCode },
              requiresShipping: false,
              taxable: true,
              customAttributes: [{ key: "Seller", value: seller?.tradeName ?? "Player" }],
            },
          ],
        },
      },
    );
    const draft = data.draftOrderCreate.draftOrder as { id: string; invoiceUrl: string };
    await db.listing.update({ where: { id: held.listing.id }, data: { draftOrderId: draft.id, invoiceUrl: draft.invoiceUrl } });
    return { invoiceUrl: draft.invoiceUrl };
  } catch (error) {
    await db.listing.update({
      where: { id: held.listing.id },
      data: { status: "ACTIVE", buyerCustomerId: null, checkoutExpiresAt: null, draftOrderId: null, invoiceUrl: null },
    });
    throw error;
  }
}

/** The buyer's invoice was paid: the card moves to their vault and the seller's credit is scheduled. */
export async function completeSale(db: Db, listingId: string, orderId: string, orderName: string, now = new Date()) {
  return db.$transaction(async (tx) => {
    const listing = await tx.listing.findUnique({ where: { id: listingId } });
    if (!listing || listing.status === "SOLD") return null;
    const settings = await marketSettings(tx, listing.shop);
    const [l] = await lockPulls(tx, [listing.pullId]);
    const buyer = listing.buyerCustomerId;
    const sellerStillOwns = l && l.pull.customerId === listing.sellerCustomerId && l.pull.status === "REVEALED";
    if (!buyer || !sellerStillOwns) {
      // Paid, but the card can't move (should not happen while the listing is held). Staff refund the buyer.
      await tx.listing.update({
        where: { id: listing.id },
        data: { status: "SOLD", orderId, orderName, soldAt: now, payoutStatus: "FLAGGED", flagReason: "Paid but the card was no longer available: refund the buyer." },
      });
      return null;
    }
    await transfer(tx, listing.shop, [{ pullId: listing.pullId, from: listing.sellerCustomerId, to: buyer }], "SALE", { listingId: listing.id }, now);
    const payoutAmount = Math.round(Number(listing.price) * (100 - settings.feePercent)) / 100;
    // No hold: the seller is paid in Vault Credit the moment the buyer's payment clears.
    const payNow = PAYOUT_HOLD_DAYS === 0;
    if (payNow) {
      await addCredit(tx, { shop: listing.shop, customerId: listing.sellerCustomerId, amount: payoutAmount, kind: "SALE", listingId: listing.id, note: orderName });
    }
    return tx.listing.update({
      where: { id: listing.id },
      data: {
        status: "SOLD",
        orderId,
        orderName,
        soldAt: now,
        payoutStatus: payNow ? "PAID" : "HELD",
        payoutAmount,
        payoutDueAt: new Date(now.getTime() + PAYOUT_HOLD_DAYS * DAY),
        paidOutAt: payNow ? now : null,
      },
    });
  });
}

/**
 * A marketplace order was refunded or cancelled: an unpaid seller credit is held, and a paid one is
 * marked for staff, who can reverse the sale (which takes the credit back, even below zero).
 */
export async function flagMarketOrder(db: Db, orderId: string, reason: string) {
  const held = await db.listing.updateMany({
    where: { orderId, payoutStatus: "HELD" },
    data: { payoutStatus: "FLAGGED", flagReason: reason },
  });
  const paid = await db.listing.updateMany({
    where: { orderId, payoutStatus: "PAID" },
    data: { flagReason: `${reason} Reverse the sale to take the seller's credit back.` },
  });
  return held.count + paid.count;
}

/** Staff: sends a sold card back to the seller (e.g. the buyer was refunded) and cancels the credit. */
export async function reverseSale(db: Db, shop: string, listingId: string, now = new Date()) {
  return db.$transaction(async (tx) => {
    const listing = await tx.listing.findFirst({ where: { id: listingId, shop } });
    if (!listing || listing.status !== "SOLD" || !listing.buyerCustomerId) throw new PoolError("Only a sold card can be reversed.");
    const [l] = await lockPulls(tx, [listing.pullId]);
    const shipping = l?.pull.shipRequestId && LIVE_SHIP.includes(l.pull.shipRequest?.status ?? "");
    if (!l || l.pull.customerId !== listing.buyerCustomerId || l.pull.status !== "REVEALED" || shipping) {
      throw new PoolError("The buyer no longer has that card in their vault.");
    }
    await transfer(tx, shop, [{ pullId: listing.pullId, from: listing.buyerCustomerId, to: listing.sellerCustomerId }], "REVERSAL", { listingId: listing.id }, now);
    // A paid seller gives the Vault Credit back (refused if they've spent it). A card bought with
    // Vault Credit refunds the buyer's credit; a card bought by card is refunded in Shopify by staff.
    if (listing.payoutStatus === "PAID" && listing.payoutAmount) {
      // Taken back even if already spent: the balance can go below zero and is repaid from future sales.
      await addCredit(tx, { shop, customerId: listing.sellerCustomerId, amount: -Number(listing.payoutAmount), kind: "ADJUST", listingId: listing.id, note: "Sale reversed" });
    }
    if (!listing.orderId) {
      await addCredit(tx, { shop, customerId: listing.buyerCustomerId, amount: Number(listing.price), kind: "ADJUST", listingId: listing.id, note: "Sale reversed" });
    }
    return tx.listing.update({ where: { id: listing.id }, data: { payoutStatus: "CANCELLED" } });
  });
}

/** Staff: clears a flag so the seller is paid on the next run. */
export async function releaseFlaggedPayout(db: Db, shop: string, listingId: string) {
  const { count } = await db.listing.updateMany({
    where: { id: listingId, shop, payoutStatus: "FLAGGED", buyerCustomerId: { not: null }, payoutAmount: { not: null } },
    data: { payoutStatus: "HELD", flagReason: null },
  });
  if (!count) throw new PoolError("That sale isn't flagged.");
}

// ---------- Scheduled jobs ----------

export async function expireOffers(db: Db, now = new Date()) {
  const { count } = await db.trade.updateMany({ where: { status: "PENDING", expiresAt: { lt: now } }, data: { status: "EXPIRED" } });
  return count;
}

/** Unpaid buyer invoices past their hold: delete the draft and put the card back on the board. */
export async function expireCheckouts(db: Db, adminFor: (shop: string) => Promise<AdminApiContext>, now = new Date()) {
  const due = await db.listing.findMany({ where: { status: "CHECKOUT", checkoutExpiresAt: { lt: now } } });
  for (const listing of due) {
    try {
      const admin = await adminFor(listing.shop);
      if (listing.draftOrderId) {
        const data = await gql(admin, `#graphql
          query MarketDraftStatus($id: ID!) { draftOrder(id: $id) { id order { id name } } }`, { id: listing.draftOrderId });
        const draft = data.draftOrder as { order: { id: string; name: string } | null } | null;
        if (draft?.order) {
          await completeSale(db, listing.id, draft.order.id, draft.order.name, now);
          continue;
        }
        if (draft) {
          await gql(admin, `#graphql
            mutation MarketDraftDelete($input: DraftOrderDeleteInput!) { draftOrderDelete(input: $input) { deletedId userErrors { field message } } }`,
            { input: { id: listing.draftOrderId } });
        }
      }
      await db.listing.updateMany({
        where: { id: listing.id, status: "CHECKOUT" },
        data: { status: "ACTIVE", buyerCustomerId: null, checkoutExpiresAt: null, draftOrderId: null, invoiceUrl: null },
      });
    } catch (error) {
      console.error(`Expiring market checkout ${listing.id} failed`, error);
    }
  }
}

/** Pays sellers whose hold has passed, in Vault Credit. */
export async function payOutSellers(db: Db, adminFor: (shop: string) => Promise<AdminApiContext>, now = new Date()) {
  const due = await db.listing.findMany({ where: { payoutStatus: "HELD", payoutDueAt: { lt: now } }, take: 100 });
  let paid = 0;
  for (const listing of due) {
    try {
      const done = await db.$transaction(async (tx) => {
        // Claim first so a second run can't pay twice.
        const claimed = await tx.listing.updateMany({ where: { id: listing.id, payoutStatus: "HELD" }, data: { payoutStatus: "PAID", paidOutAt: now } });
        if (!claimed.count) return false;
        await addCredit(tx, { shop: listing.shop, customerId: listing.sellerCustomerId, amount: Number(listing.payoutAmount), kind: "SALE", listingId: listing.id, note: listing.orderName ?? undefined });
        return true;
      });
      if (!done) continue;
      paid++;
      await notify(await adminFor(listing.shop).catch(() => undefined), listing.sellerCustomerId, METRICS.payout, { amount: Number(listing.payoutAmount).toFixed(2) });
    } catch (error) {
      console.error(`Paying out listing ${listing.id} failed`, error);
    }
  }
  return paid;
}

/**
 * Buys a listed card with Vault Credit: no Shopify order. The card moves to the buyer and the
 * seller is paid in Vault Credit right away (credit can't be charged back).
 */
export async function buyWithCredit(db: Db, shop: string, buyerCustomerId: string, listingId: string, now = new Date()) {
  const settings = await requireEnabled(db, shop, true);
  await requireTrader(db, shop, buyerCustomerId);
  return db.$transaction(async (tx) => {
    const listing = await tx.listing.findFirst({ where: { id: listingId, shop } });
    if (!listing || listing.status !== "ACTIVE") throw new PoolError("That card isn't for sale anymore.");
    if (listing.sellerCustomerId === buyerCustomerId) throw new PoolError("That's your own card.");
    const [l] = await lockPulls(tx, [listing.pullId]);
    if (!l || l.pull.customerId !== listing.sellerCustomerId || lockReason(l.pull, l.vault, now)) throw new PoolError("That card isn't for sale anymore.");
    const claimed = await tx.listing.updateMany({ where: { id: listing.id, status: "ACTIVE" }, data: { status: "SOLD", buyerCustomerId, soldAt: now } });
    if (!claimed.count) throw new PoolError("Someone else is buying that card right now.");
    const price = Number(listing.price);
    await spendCredit(tx, { shop, customerId: buyerCustomerId, amount: price, kind: "PURCHASE", listingId: listing.id, note: l.pull.slot.card.title });
    await transfer(tx, shop, [{ pullId: listing.pullId, from: listing.sellerCustomerId, to: buyerCustomerId }], "SALE", { listingId: listing.id }, now);
    const payoutAmount = Math.round(price * (100 - settings.feePercent)) / 100;
    await addCredit(tx, { shop, customerId: listing.sellerCustomerId, amount: payoutAmount, kind: "SALE", listingId: listing.id, note: l.pull.slot.card.title });
    return tx.listing.update({
      where: { id: listing.id },
      data: { orderName: "Vault Credit", payoutStatus: "PAID", payoutAmount, payoutDueAt: now, paidOutAt: now },
    });
  });
}

// ---------- Emails (Klaviyo events; flows send the emails) ----------

async function customerEmail(admin: AdminApiContext, customerId: string) {
  const data = await gql(admin, `#graphql
    query MarketCustomerEmail($id: ID!) { customer(id: $id) { defaultEmailAddress { emailAddress } } }`, { id: customerId });
  return (data.customer?.defaultEmailAddress?.emailAddress as string | null) ?? null;
}

/** Best effort: a missing key or a Klaviyo error never blocks a trade. */
export async function notify(admin: AdminApiContext | undefined, customerId: string, metric: string, properties: Record<string, unknown>) {
  if (!admin || !process.env.KLAVIYO_PRIVATE_KEY) return;
  try {
    const email = await customerEmail(admin, customerId);
    if (email) await klaviyoEvent(email, metric, { ...properties, marketUrl: "/apps/packs/market" });
  } catch (error) {
    console.error(`Marketplace email ${metric} failed`, error);
  }
}

// ---------- Hooks into the vault ----------

/** Cards a buyer is paying for right now: they stay out of shipments until that settles. */
export async function beingBought(db: Db | Tx, pullIds: string[]) {
  if (pullIds.length === 0) return new Set<string>();
  const buying = await db.listing.findMany({ where: { pullId: { in: pullIds }, status: "CHECKOUT" }, select: { pullId: true } });
  return new Set(buying.map((b) => b.pullId));
}

/** Cards going on a shipment: their open offers and listings are withdrawn. */
export async function withdrawFromMarket(db: Db | Tx, ids: string[]) {
  if (ids.length === 0) return;
  await db.listing.updateMany({ where: { pullId: { in: ids }, status: "ACTIVE" }, data: { status: "CANCELLED" } });
  await cancelPendingTrades(db, ids);
  await db.pull.updateMany({ where: { id: { in: ids } }, data: { openToTrade: false } });
}

/** Staff admin: recent trades and sales with trade names. */
export async function marketActivity(db: Db, shop: string, take = 50) {
  const [trades, listings, flagged, traders] = await Promise.all([
    db.trade.findMany({
      where: { shop, status: { in: ["ACCEPTED", "REVERSED"] } },
      include: { items: { include: { pull: { include: { slot: { include: { card: true } } } } } } },
      orderBy: { updatedAt: "desc" },
      take,
    }),
    db.listing.findMany({
      where: { shop, status: "SOLD" },
      include: { pull: { include: { slot: { include: { card: true } } } } },
      orderBy: { soldAt: "desc" },
      take,
    }),
    db.pull.findMany({ where: { shop, refundFlaggedAt: { not: null } }, include: { slot: { include: { card: true } } }, orderBy: { refundFlaggedAt: "desc" }, take }),
    db.trader.findMany({ where: { shop } }),
  ]);
  const name = (id: string | null) => traders.find((t) => t.customerId === id)?.tradeName ?? id ?? "";
  return {
    trades: trades.map((t) => ({
      id: t.id,
      status: t.status,
      date: t.respondedAt ?? t.updatedAt,
      from: name(t.fromCustomerId),
      to: name(t.toCustomerId),
      gave: t.items.filter((i) => i.side === "GIVE").map((i) => i.pull.slot.card.title),
      got: t.items.filter((i) => i.side === "GET").map((i) => i.pull.slot.card.title),
    })),
    sales: listings.map((l) => ({
      id: l.id,
      card: l.pull.slot.card.title,
      seller: name(l.sellerCustomerId),
      buyer: name(l.buyerCustomerId),
      price: Number(l.price),
      payout: l.payoutAmount === null ? null : Number(l.payoutAmount),
      payoutStatus: l.payoutStatus,
      payoutDueAt: l.payoutDueAt,
      orderName: l.orderName,
      flagReason: l.flagReason,
      soldAt: l.soldAt,
    })),
    flagged: flagged.map((p) => ({ pullId: p.id, card: p.slot.card.title, orderName: p.orderName, owner: name(p.customerId), at: p.refundFlaggedAt })),
    traders: traders.length,
  };
}

/** Staff: a refund-flagged card has been reviewed (kept by its owner). */
export async function clearRefundFlag(db: Db, shop: string, pullId: string) {
  await db.pull.updateMany({ where: { id: pullId, shop }, data: { refundFlaggedAt: null } });
}

// ---------- Collections (opt-in) and collectors ----------

export const MAX_SHOWCASE = 6;

export async function setCollectionSettings(
  db: Db,
  shop: string,
  customerId: string,
  input: { showCollection?: boolean; showcase?: string[] },
) {
  await requireEnabled(db, shop);
  await requireTrader(db, shop, customerId);
  const data: { showCollection?: boolean; showcase?: string[] } = {};
  if (input.showCollection !== undefined) data.showCollection = input.showCollection;
  if (input.showcase) {
    const ids = [...new Set(input.showcase)].slice(0, MAX_SHOWCASE);
    const owned = await db.pull.count({ where: { id: { in: ids }, shop, customerId, status: "REVEALED" } });
    if (owned !== ids.length) throw new PoolError("Pick cards from your own vault for your showcase.");
    data.showcase = ids;
  }
  return db.trader.update({ where: { shop_customerId: { shop, customerId } }, data });
}

/** Completed trades per customer (either side of an accepted trade). */
async function tradeCounts(db: Db, shop: string, customerIds: string[]) {
  const counts = new Map<string, number>();
  if (customerIds.length === 0) return counts;
  const trades = await db.trade.findMany({
    where: { shop, status: "ACCEPTED", OR: [{ fromCustomerId: { in: customerIds } }, { toCustomerId: { in: customerIds } }] },
    select: { fromCustomerId: true, toCustomerId: true },
  });
  for (const t of trades) {
    for (const id of [t.fromCustomerId, t.toCustomerId]) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** The vault cards that count as a player's collection: opened, in the vault, not shipping. */
async function collectionPulls(db: Db, shop: string, customerIds: string[]) {
  const pulls = await db.pull.findMany({
    where: { shop, customerId: { in: customerIds }, status: "REVEALED" },
    include: marketInclude,
    orderBy: { createdAt: "desc" },
  });
  const vault = await vaultOrderIds(db, pulls.map((p) => p.orderId));
  return pulls.filter((p) => vault.has(p.orderId) && !(p.shipRequestId && LIVE_SHIP.includes(p.shipRequest?.status ?? "")));
}

/**
 * One player's collection page. A shared collection shows every vault card; otherwise only the
 * cards they put up for trade or sale. Their own page always shows everything.
 */
export async function collectionFor(db: Db, shop: string, tradeName: string, viewerId: string, now = new Date()) {
  const settings = await marketSettings(db, shop);
  const trader = await db.trader.findUnique({ where: { shop_nameKey: { shop, nameKey: tradeName.trim().toLowerCase() } } });
  if (!trader) throw new PoolError("No collector by that name.");
  const own = trader.customerId === viewerId;
  const pulls = await collectionPulls(db, shop, [trader.customerId]);
  const view = pulls
    .map((p) => {
      const listing = settings.sellingEnabled ? p.listings.find((l) => l.status === "ACTIVE") : undefined;
      const locked = lockReason(p, true, now);
      return {
        ...cardView(p),
        openToTrade: p.openToTrade && !locked,
        listing: listing && !locked ? { id: listing.id, price: Number(listing.price) } : null,
      };
    })
    .filter((c) => own || trader.showCollection || c.openToTrade || c.listing);
  const showcase = trader.showcase.map((id) => view.find((c) => c.pullId === id)).filter((c) => !!c);
  const trades = (await tradeCounts(db, shop, [trader.customerId])).get(trader.customerId) ?? 0;
  return {
    name: trader.tradeName,
    own,
    shared: trader.showCollection,
    since: trader.createdAt,
    trades,
    stats: {
      cards: view.length,
      sets: new Set(view.map((c) => c.series)).size,
      forTrade: view.filter((c) => c.openToTrade).length,
      forSale: view.filter((c) => c.listing).length,
    },
    showcase,
    cards: view,
  };
}

/** Players with something to look at: a shared collection or cards up for trade or sale. */
export async function collectors(db: Db, shop: string, viewerId: string, now = new Date()) {
  const settings = await marketSettings(db, shop);
  const traders = await db.trader.findMany({ where: { shop, customerId: { not: viewerId } } });
  if (traders.length === 0) return [];
  const pulls = await collectionPulls(db, shop, traders.map((t) => t.customerId));
  const trades = await tradeCounts(db, shop, traders.map((t) => t.customerId));
  return traders
    .map((t) => {
      const mine = pulls.filter((p) => p.customerId === t.customerId);
      const up = mine.filter((p) => !lockReason(p, true, now) && (p.openToTrade || (settings.sellingEnabled && p.listings.some((l) => l.status === "ACTIVE"))));
      const visible = t.showCollection ? mine : up;
      const pinned = t.showcase.map((id) => visible.find((p) => p.id === id)).filter((p) => !!p);
      const preview = [...pinned, ...visible.filter((p) => !pinned.includes(p))].slice(0, 3);
      return {
        name: t.tradeName,
        shared: t.showCollection,
        since: t.createdAt,
        trades: trades.get(t.customerId) ?? 0,
        cards: visible.length,
        forTrade: up.length,
        preview: preview.map((p) => ({ title: p.slot.card.title, imageUrl: p.slot.card.imageUrl })),
      };
    })
    .filter((c) => c.cards > 0)
    .sort((a, b) => b.forTrade - a.forTrade || b.cards - a.cards);
}

// ---------- Wishlist, trade matches, activity ----------

export const MAX_WISHES = 100;

/** Who wants each card: variantId -> customer ids with it on their wishlist. */
async function wishers(db: Db | Tx, shop: string, variantIds: string[]) {
  const map = new Map<string, string[]>();
  if (variantIds.length === 0) return map;
  const rows = await db.wishItem.findMany({ where: { shop, variantId: { in: [...new Set(variantIds)] } }, select: { variantId: true, customerId: true } });
  for (const r of rows) map.set(r.variantId, [...(map.get(r.variantId) ?? []), r.customerId]);
  return map;
}

/** Cards a player can add to their wishlist: every single that has been in a pack series here. */
export async function catalog(db: Db, shop: string, q: string, take = 40) {
  const cards = await db.card.findMany({
    where: { series: { shop }, ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}) },
    select: { variantId: true, title: true, imageUrl: true },
    orderBy: { title: "asc" },
    distinct: ["variantId"],
    take,
  });
  return cards.map((c) => ({ cardKey: c.variantId, title: c.title, imageUrl: c.imageUrl }));
}

export async function addWish(db: Db, shop: string, customerId: string, variantId: string) {
  await requireEnabled(db, shop);
  await requireTrader(db, shop, customerId);
  const card = await db.card.findFirst({ where: { variantId, series: { shop } }, orderBy: { id: "desc" } });
  if (!card) throw new PoolError("That card isn't in the catalog.");
  const count = await db.wishItem.count({ where: { shop, customerId } });
  if (count >= MAX_WISHES) throw new PoolError(`Your wishlist holds up to ${MAX_WISHES} cards.`);
  return db.wishItem.upsert({
    where: { shop_customerId_variantId: { shop, customerId, variantId } },
    create: { shop, customerId, variantId, title: card.title, imageUrl: card.imageUrl },
    update: {},
  });
}

export async function removeWish(db: Db, shop: string, customerId: string, variantId: string) {
  await db.wishItem.deleteMany({ where: { shop, customerId, variantId } });
}

/** The viewer's wishlist, each with how many copies are up right now (not their own). */
export async function wishlist(db: Db, shop: string, customerId: string, board?: { cardKey: string; trader: string }[]) {
  const items = await db.wishItem.findMany({ where: { shop, customerId }, orderBy: { createdAt: "desc" } });
  const up = board ?? (await boardCards(db, shop, customerId));
  return items.map((w) => ({
    cardKey: w.variantId,
    title: w.title,
    imageUrl: w.imageUrl,
    available: up.filter((c) => c.cardKey === w.variantId).length,
  }));
}

/**
 * Trade Matches: other players who have a card on the viewer's wishlist up for trade, and what
 * of the viewer's tradable cards is on that player's wishlist. Both sides = a perfect match.
 */
export async function tradeMatches(db: Db, shop: string, customerId: string, now = new Date()) {
  const [mine, board, myWishes] = await Promise.all([
    myMarketCards(db, shop, customerId, now),
    boardCards(db, shop, customerId, { now }),
    db.wishItem.findMany({ where: { shop, customerId }, select: { variantId: true } }),
  ]);
  const want = new Set(myWishes.map((w) => w.variantId));
  const tradable = mine.filter((c) => !c.locked);
  const traders = await db.trader.findMany({ where: { shop, tradeName: { in: [...new Set(board.map((c) => c.trader))] } } });
  const theirWishes = await db.wishItem.findMany({ where: { shop, customerId: { in: traders.map((t) => t.customerId) } }, select: { customerId: true, variantId: true } });
  const matches = traders.map((t) => {
    const wants = new Set(theirWishes.filter((w) => w.customerId === t.customerId).map((w) => w.variantId));
    return {
      trader: t.tradeName,
      theyHave: board.filter((c) => c.trader === t.tradeName && c.openToTrade && want.has(c.cardKey)),
      theyWant: tradable.filter((c) => wants.has(c.cardKey)),
    };
  });
  return matches
    .filter((m) => m.theyHave.length || m.theyWant.length)
    .map((m) => ({ ...m, perfect: m.theyHave.length > 0 && m.theyWant.length > 0 }))
    .sort((a, b) => Number(b.perfect) - Number(a.perfect) || b.theyHave.length + b.theyWant.length - (a.theyHave.length + a.theyWant.length));
}

/** Recent marketplace happenings for the feed. No prices: listings, sales and trades only. */
export async function activityFeed(db: Db, shop: string, take = 24) {
  const settings = await marketSettings(db, shop);
  const [listings, trades, traders] = await Promise.all([
    settings.sellingEnabled
      ? db.listing.findMany({ where: { shop }, include: { pull: { include: { slot: { include: { card: true } } } } }, orderBy: { createdAt: "desc" }, take })
      : Promise.resolve([]),
    db.trade.findMany({
      where: { shop, status: "ACCEPTED" },
      include: { items: { include: { pull: { include: { slot: { include: { card: true } } } } } } },
      orderBy: { respondedAt: "desc" },
      take,
    }),
    db.trader.findMany({ where: { shop } }),
  ]);
  const name = (id: string | null) => traders.find((t) => t.customerId === id)?.tradeName ?? "A Collector";
  const card = (p: { slot: { card: { title: string; imageUrl: string | null } } }) => ({ title: p.slot.card.title, imageUrl: p.slot.card.imageUrl });
  const events = [
    ...listings.map((l) => ({ type: "listed", at: l.createdAt, who: name(l.sellerCustomerId), cards: [card(l.pull)] })),
    ...listings.filter((l) => l.status === "SOLD" && l.soldAt).map((l) => ({ type: "sold", at: l.soldAt!, who: name(l.buyerCustomerId), from: name(l.sellerCustomerId), cards: [card(l.pull)] })),
    ...trades.map((t) => ({
      type: "trade",
      at: t.respondedAt ?? t.updatedAt,
      who: name(t.fromCustomerId),
      from: name(t.toCustomerId),
      cards: t.items.map((i) => card(i.pull)),
    })),
  ];
  return events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, take);
}

/**
 * Wishlist alerts: cards that just went up for trade or sale email the players who want them,
 * once per copy. Called after a card is marked open to trade or listed.
 */
export async function sendWishlistAlerts(db: Db, admin: AdminApiContext | undefined, shop: string, pullId: string) {
  const pull = await db.pull.findUnique({ where: { id: pullId }, include: { slot: { include: { card: true } } } });
  if (!pull?.customerId) return 0;
  const owner = await traderFor(db, shop, pull.customerId);
  const wishes = await db.wishItem.findMany({
    where: { shop, variantId: pull.slot.card.variantId, customerId: { not: pull.customerId }, NOT: { alertedPullIds: { has: pullId } } },
  });
  for (const w of wishes) {
    await db.wishItem.update({ where: { id: w.id }, data: { alertedPullIds: { push: pullId } } });
    await notify(admin, w.customerId, METRICS.wishAvailable, { card: pull.slot.card.title, imageUrl: pull.slot.card.imageUrl, from: owner?.tradeName });
  }
  return wishes.length;
}

// ---------- Staff preview (/apps/packs/market?demo=<token>) ----------

const DEMO_TRADERS = ["AshK", "MistyM", "BrockRocks", "GaryOak22"];

/**
 * Sample Vault Marketplace data from the newest series' cards (real names and images), so staff
 * can see the page in its real setting. Nothing here reads or changes any customer's vault.
 * `view` mirrors the live API: the main page, the collector list, or one collection.
 */
export async function marketDemo(db: Db, shop: string, { view = "", name = "" } = {}) {
  const settings = await marketSettings(db, shop);
  const series = (await db.series.findFirst({ where: { shop, status: { not: "DRAFT" } }, orderBy: { createdAt: "desc" } }))
    ?? (await db.series.findFirst({ where: { shop }, orderBy: { createdAt: "desc" } }));
  const cards = series ? await db.card.findMany({ where: { seriesId: series.id, imageUrl: { not: null } }, orderBy: { title: "asc" }, take: 120 }) : [];
  // Spread the sample across tiers so it isn't all one kind of card.
  const tiers = [...new Set(cards.map((c) => c.tier))];
  const byTier = tiers.map((t) => cards.filter((c) => c.tier === t));
  const spread: typeof cards = [];
  for (let i = 0; spread.length < cards.length; i++) {
    for (const list of byTier) if (list[i]) spread.push(list[i]);
    if (i > cards.length) break;
  }
  const sample = spread.map((c, i) => ({ pullId: `demo-${i}`, cardKey: c.variantId, title: c.title, imageUrl: c.imageUrl, series: series!.title, wantedBy: [0, 2, 0, 1, 5, 0, 3][i % 7] }));
  const price = (i: number) => [4, 12.5, 25, 8, 40, 3, 15, 6][i % 8];
  const mine = sample.slice(0, 8);
  const theirs = sample.slice(8, 60);
  const owned = DEMO_TRADERS.map((trader, t) =>
    theirs.filter((_, i) => i % DEMO_TRADERS.length === t).map((c, i) => ({
      ...c,
      trader,
      openToTrade: i % 3 !== 2,
      listing: i % 2 === 0 || i % 3 === 2 ? { id: `demo-listing-${t}-${i}`, price: price(i + t) } : null,
    })),
  );
  // AshK and GaryOak22 share their whole vault; the others only show cards they put up.
  const shared = (t: number) => t === 0 || t === 3;
  const up = (c: { openToTrade: boolean; listing: unknown }) => c.openToTrade || !!c.listing;
  const board = owned.flatMap((list, t) => list.filter((c, i) => up(c) && (shared(t) ? i % 2 === 0 : true)));
  const since = (t: number) => new Date(Date.now() - (40 + t * 23) * DAY);
  const tradesDone = [12, 5, 0, 31];

  const collection = (who: string) => {
    if (who.toLowerCase() === "previewtrader") {
      return { name: "PreviewTrader", own: true, shared: true, since: new Date(Date.now() - 12 * DAY), trades: 3,
        stats: { cards: mine.length, sets: 1, forTrade: 2, forSale: 1 }, showcase: mine.slice(0, 3),
        cards: mine.map((c, i) => ({ ...c, openToTrade: i < 2, listing: i === 0 ? { id: "demo-mine-0", price: 20 } : null })) };
    }
    const t = DEMO_TRADERS.findIndex((n) => n.toLowerCase() === who.toLowerCase());
    if (t < 0) throw new PoolError("No collector by that name.");
    const visible = owned[t].filter((c) => shared(t) || up(c)).map((c) => ({ ...c, openToTrade: c.openToTrade, listing: c.listing }));
    return {
      name: DEMO_TRADERS[t], own: false, shared: shared(t), since: since(t), trades: tradesDone[t],
      stats: { cards: visible.length, sets: 1, forTrade: visible.filter((c) => c.openToTrade).length, forSale: visible.filter((c) => c.listing).length },
      showcase: shared(t) ? visible.slice(0, 6) : [],
      cards: visible,
    };
  };
  // PreviewTrader wants a few cards that are up, plus one that isn't; two collectors want PreviewTrader's cards.
  const wishCards = [board[1], board[5], board[9], board[14], sample[70] ?? sample[sample.length - 1]].filter(Boolean);
  const matches = () => {
    const wants: Record<string, typeof mine> = { MistyM: [mine[3], mine[4]], BrockRocks: [mine[5]] };
    return DEMO_TRADERS.map((trader) => ({
      trader,
      theyHave: board.filter((c) => c.trader === trader && c.openToTrade && wishCards.some((w) => w.cardKey === c.cardKey)),
      theyWant: (wants[trader] ?? []).filter(Boolean),
    }))
      .filter((m) => m.theyHave.length || m.theyWant.length)
      .map((m) => ({ ...m, perfect: m.theyHave.length > 0 && m.theyWant.length > 0 }))
      .sort((a, b) => Number(b.perfect) - Number(a.perfect));
  };
  if (view === "collection") return collection(name);
  if (view === "matches") return matches();
  if (view === "catalog") return catalog(db, shop, name);
  if (view === "wallet") {
    const ago = (h: number) => new Date(Date.now() - h * 3_600_000);
    return {
      balance: 37.5,
      codesEnabled: true,
      codeDays: 30,
      codes: [{ id: "demo-code", code: "VAULT-7KQ2M9XA", amount: 15, status: "ACTIVE", usedAmount: null, orderName: null, expiresAt: new Date(Date.now() + 26 * DAY) }],
      history: [
        { id: "h1", amount: -15, kind: "CODE", note: "VAULT-7KQ2M9XA", at: ago(3) },
        { id: "h2", amount: 22.5, kind: "SALE", note: mine[0]?.title ?? "Card", at: ago(30) },
        { id: "h3", amount: -12.5, kind: "PURCHASE", note: board[3]?.title ?? "Card", at: ago(50) },
        { id: "h4", amount: 4.5, kind: "CODE_RETURN", note: "Unused part of VAULT-P3W8", at: ago(80) },
        { id: "h5", amount: 38, kind: "SALE", note: mine[1]?.title ?? "Card", at: ago(120) },
      ],
    };
  }
  if (view === "collectors") {
    return DEMO_TRADERS.map((n) => {
      const c = collection(n);
      return { name: n, shared: c.shared, since: c.since, trades: c.trades, cards: c.stats.cards, forTrade: c.cards.filter(up).length,
        preview: c.cards.slice(0, 3).map((x) => ({ title: x.title, imageUrl: x.imageUrl })) };
    });
  }

  const expires = new Date(Date.now() + 5 * DAY);
  return {
    enabled: true,
    signedIn: true,
    demo: true,
    selling: true,
    feePercent: settings.feePercent,
    rules: { waitDays: TRADE_WAIT_DAYS, offerDays: OFFER_DAYS, payoutDays: PAYOUT_HOLD_DAYS, maxCards: MAX_SIDE_CARDS, maxOffers: MAX_OPEN_OFFERS, minPrice: MIN_PRICE, maxPrice: MAX_PRICE, maxShowcase: MAX_SHOWCASE },
    notes: OFFER_NOTES,
    tradeName: "PreviewTrader",
    credit: 37.5,
    me: { tradeName: "PreviewTrader", showCollection: true, showcase: mine.slice(0, 3).map((c) => c.pullId) },
    cards: mine.map((c, i) => ({
      ...c,
      openToTrade: i < 2,
      locked: i === 7 ? "Tradable In 9 Days" : null,
      listing: i === 0 ? { id: "demo-mine-0", price: 20, status: "ACTIVE" } : null,
      inOffer: i === 1,
    })),
    board,
    wishlist: wishCards.map((c) => ({ cardKey: c.cardKey, title: c.title, imageUrl: c.imageUrl, available: board.filter((b) => b.cardKey === c.cardKey).length })),
    feed: board.slice(0, 10).map((c, i) => {
      const at = new Date(Date.now() - (i * 47 + 6) * 60_000);
      if (i % 3 === 1) return { type: "trade", at, who: c.trader, from: DEMO_TRADERS[(i + 1) % 4], cards: [c, board[i + 10] ?? c] };
      if (i % 4 === 2) return { type: "sold", at, who: DEMO_TRADERS[(i + 2) % 4], from: c.trader, cards: [c] };
      return { type: "listed", at, who: c.trader, cards: [c] };
    }),
    offers: mine.length > 2 && board.length > 2
      ? [
          { id: "demo-offer-in", incoming: true, with: "MistyM", note: OFFER_NOTES[0], expiresAt: expires, youGive: [mine[2]], youGet: [board[1], board[2]] },
          { id: "demo-offer-out", incoming: false, with: "AshK", note: null, expiresAt: expires, youGive: [mine[1]], youGet: [board[0]] },
        ]
      : [],
  };
}
