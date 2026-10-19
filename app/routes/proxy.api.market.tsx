import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { PoolError } from "../lib/pool.server";
import { json, proxyContext } from "../lib/proxy.server";
import { validDemoToken } from "../lib/demo.server";
import { priceGuideFor } from "../lib/price-guide.server";
import { createCreditCode, creditBalance, creditWallet, returnCreditCode, CODE_DAYS } from "../lib/credit.server";
import {
  activityFeed,
  addWish,
  boardCards,
  buyWithCredit,
  catalog,
  cancelListing,
  cancelOffer,
  createListing,
  createOffer,
  marketSettings,
  MAX_OPEN_OFFERS,
  MAX_PRICE,
  MAX_SIDE_CARDS,
  METRICS,
  MIN_PRICE,
  collectionFor,
  collectors,
  hasMarketAccess,
  marketDemo,
  MAX_SHOWCASE,
  myMarketCards,
  myOffers,
  notify,
  OFFER_DAYS,
  OFFER_NOTES,
  PAYOUT_HOLD_DAYS,
  removeWish,
  respondToOffer,
  sendWishlistAlerts,
  setCollectionSettings,
  setOpenToTrade,
  setTradeName,
  startPurchase,
  tradeMatches,
  traderFor,
  acceptTerms,
  agreedToTerms,
  requireTerms,
  TERMS_URL,
  wishlist,
  TRADE_WAIT_DAYS,
} from "../lib/market.server";

// Vault Marketplace data for the logged-in customer: their cards, the Trade Board, and offers.
// Only trade names are shown for other players, and pack card values are never included.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, viewer, admin } = await proxyContext(request);
  // Staff preview link: sample data, shown even while the marketplace is off.
  const params = new URL(request.url).searchParams;
  const view = params.get("view") ?? "";
  const name = params.get("name")?.slice(0, 40) ?? "";
  if (validDemoToken(shop, params.get("demo"))) {
    // Sample Price Guide so the slider can be tried in the preview.
    if (view === "priceGuide") return json({ market: 12.5, printing: "Holofoil" });
    try {
      return json(await marketDemo(db, shop, { view, name }));
    } catch (error) {
      if (error instanceof PoolError) return json({ error: error.message }, 404);
      throw error;
    }
  }
  const settings = await marketSettings(db, shop);
  if (!settings.enabled) return json({ enabled: false });
  if (!viewer?.customerId) return json(settings.accessTag ? { enabled: false } : { enabled: true, signedIn: false });
  if (!(await hasMarketAccess(db, admin, shop, viewer.customerId))) return json({ enabled: false });
  if (view === "collectors") return json(await collectors(db, shop, viewer.customerId));
  if (view === "matches") return json(await tradeMatches(db, shop, viewer.customerId));
  if (view === "wallet") return json({ ...(await creditWallet(db, shop, viewer.customerId)), codesEnabled: settings.creditCollections > 0, codeDays: CODE_DAYS });
  if (view === "priceGuide") return json(admin ? await priceGuideFor(db, admin, shop, viewer.customerId, params.get("pull") ?? "") : { market: null });
  if (view === "catalog") return json(await catalog(db, shop, params.get("q")?.slice(0, 60) ?? ""));
  if (view === "collection") {
    try {
      return json(await collectionFor(db, shop, name, viewer.customerId));
    } catch (error) {
      if (error instanceof PoolError) return json({ error: error.message }, 404);
      throw error;
    }
  }
  const q = params.get("q")?.slice(0, 60) ?? "";
  const [me, cards, board, offers, feed] = await Promise.all([
    traderFor(db, shop, viewer.customerId),
    myMarketCards(db, shop, viewer.customerId),
    boardCards(db, shop, viewer.customerId, { q }),
    myOffers(db, shop, viewer.customerId),
    activityFeed(db, shop),
  ]);
  const wishes = await wishlist(db, shop, viewer.customerId, board);
  const credit = await creditBalance(db, shop, viewer.customerId);
  return json({
    enabled: true,
    signedIn: true,
    selling: settings.sellingEnabled,
    feePercent: settings.feePercent,
    rules: { waitDays: TRADE_WAIT_DAYS, offerDays: OFFER_DAYS, payoutDays: PAYOUT_HOLD_DAYS, maxCards: MAX_SIDE_CARDS, maxOffers: MAX_OPEN_OFFERS, minPrice: MIN_PRICE, maxPrice: MAX_PRICE, maxShowcase: MAX_SHOWCASE },
    notes: OFFER_NOTES,
    tradeName: me?.tradeName ?? null,
    termsAccepted: agreedToTerms(me),
    termsUrl: TERMS_URL,
    me: me ? { tradeName: me.tradeName, showCollection: me.showCollection, showcase: me.showcase } : null,
    cards,
    board,
    offers,
    wishlist: wishes,
    credit,
    feed,
  });
};

type Body = {
  action?: string;
  name?: string;
  pullId?: string;
  on?: boolean;
  price?: number;
  listingId?: string;
  tradeId?: string;
  give?: string[];
  get?: string[];
  note?: string | null;
  counterOfId?: string | null;
  showCollection?: boolean;
  showcase?: string[];
  cardKey?: string;
  amount?: number;
  codeId?: string;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, viewer, admin } = await proxyContext(request);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (validDemoToken(shop, new URL(request.url).searchParams.get("demo"))) return json({ ok: true, demo: true });
  const me = viewer?.customerId;
  if (!me) return json({ error: "Log in to trade." }, 401);
  if (!(await hasMarketAccess(db, admin, shop, me))) return json({ error: "The Vault Market isn't open yet." }, 403);
  const body = (await request.json().catch(() => ({}))) as Body;
  try {
    if (["list", "buy", "buyCredit", "offer", "accept"].includes(String(body.action))) await requireTerms(db, shop, me);
    switch (body.action) {
      case "acceptTerms":
        await acceptTerms(db, shop, me);
        return json({ ok: true });
      case "setName":
        await setTradeName(db, shop, me, String(body.name ?? ""));
        return json({ ok: true });
      case "collection":
        await setCollectionSettings(db, shop, me, {
          showCollection: typeof body.showCollection === "boolean" ? body.showCollection : undefined,
          showcase: Array.isArray(body.showcase) ? body.showcase.map(String) : undefined,
        });
        return json({ ok: true });
      case "openToTrade":
        await setOpenToTrade(db, shop, me, String(body.pullId), body.on === true);
        if (body.on === true) await sendWishlistAlerts(db, admin, shop, String(body.pullId));
        return json({ ok: true });
      case "list":
        await createListing(db, shop, me, String(body.pullId), Number(body.price));
        await sendWishlistAlerts(db, admin, shop, String(body.pullId));
        return json({ ok: true });
      case "buyCredit":
        await buyWithCredit(db, shop, me, String(body.listingId));
        return json({ ok: true });
      case "useCredit": {
        if (!admin) return json({ error: "Codes aren't available right now. Please try again." }, 503);
        const code = await createCreditCode(db, admin, shop, me, Number(body.amount));
        return json({ ok: true, code: code.code, amount: Number(code.amount) });
      }
      case "returnCode":
        if (!admin) return json({ error: "Please try again in a moment." }, 503);
        await returnCreditCode(db, admin, shop, me, String(body.codeId));
        return json({ ok: true });
      case "wish":
        await addWish(db, shop, me, String(body.cardKey));
        return json({ ok: true });
      case "unwish":
        await removeWish(db, shop, me, String(body.cardKey));
        return json({ ok: true });
      case "unlist":
        await cancelListing(db, shop, me, String(body.listingId));
        return json({ ok: true });
      case "buy": {
        if (!admin) return json({ error: "Checkout isn't available right now. Please try again." }, 503);
        const { invoiceUrl } = await startPurchase(db, admin, shop, me, String(body.listingId));
        return json({ invoiceUrl });
      }
      case "offer": {
        const trade = await createOffer(db, shop, me, {
          give: (body.give ?? []).map(String),
          get: (body.get ?? []).map(String),
          note: body.note ?? null,
          counterOfId: body.counterOfId ?? null,
        });
        const from = await traderFor(db, shop, me);
        await notify(admin, trade.toCustomerId, METRICS.offerReceived, { from: from?.tradeName, cards: trade.items.length });
        return json({ ok: true });
      }
      case "accept":
      case "decline": {
        const trade = await respondToOffer(db, shop, me, String(body.tradeId), body.action);
        const by = await traderFor(db, shop, me);
        await notify(admin, trade.fromCustomerId, body.action === "accept" ? METRICS.offerAccepted : METRICS.offerDeclined, { by: by?.tradeName });
        return json({ ok: true });
      }
      case "cancel":
        await cancelOffer(db, shop, me, String(body.tradeId));
        return json({ ok: true });
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (error) {
    if (error instanceof PoolError) return json({ error: error.message }, 400);
    console.error("Marketplace action failed", body.action, error);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};
