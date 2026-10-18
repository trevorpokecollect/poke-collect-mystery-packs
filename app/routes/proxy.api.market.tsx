import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { PoolError } from "../lib/pool.server";
import { json, proxyContext } from "../lib/proxy.server";
import { validDemoToken } from "../lib/demo.server";
import {
  boardCards,
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
  marketDemo,
  myMarketCards,
  myOffers,
  notify,
  OFFER_DAYS,
  OFFER_NOTES,
  PAYOUT_HOLD_DAYS,
  respondToOffer,
  setOpenToTrade,
  setTradeName,
  startPurchase,
  traderFor,
  TRADE_WAIT_DAYS,
} from "../lib/market.server";

// Vault Marketplace data for the logged-in customer: their cards, the Trade Board, and offers.
// Only trade names are shown for other players, and pack card values are never included.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, viewer } = await proxyContext(request);
  // Staff preview link: sample data, shown even while the marketplace is off.
  if (validDemoToken(shop, new URL(request.url).searchParams.get("demo"))) return json(await marketDemo(db, shop));
  const settings = await marketSettings(db, shop);
  if (!settings.enabled) return json({ enabled: false });
  if (!viewer?.customerId) return json({ enabled: true, signedIn: false });
  const q = new URL(request.url).searchParams.get("q")?.slice(0, 60) ?? "";
  const [me, cards, board, offers] = await Promise.all([
    traderFor(db, shop, viewer.customerId),
    myMarketCards(db, shop, viewer.customerId),
    boardCards(db, shop, viewer.customerId, { q }),
    myOffers(db, shop, viewer.customerId),
  ]);
  return json({
    enabled: true,
    signedIn: true,
    selling: settings.sellingEnabled,
    feePercent: settings.feePercent,
    rules: { waitDays: TRADE_WAIT_DAYS, offerDays: OFFER_DAYS, payoutDays: PAYOUT_HOLD_DAYS, maxCards: MAX_SIDE_CARDS, maxOffers: MAX_OPEN_OFFERS, minPrice: MIN_PRICE, maxPrice: MAX_PRICE },
    notes: OFFER_NOTES,
    tradeName: me?.tradeName ?? null,
    cards,
    board,
    offers,
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
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, viewer, admin } = await proxyContext(request);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (validDemoToken(shop, new URL(request.url).searchParams.get("demo"))) return json({ ok: true, demo: true });
  const me = viewer?.customerId;
  if (!me) return json({ error: "Log in to trade." }, 401);
  const body = (await request.json().catch(() => ({}))) as Body;
  try {
    switch (body.action) {
      case "setName":
        await setTradeName(db, shop, me, String(body.name ?? ""));
        return json({ ok: true });
      case "openToTrade":
        await setOpenToTrade(db, shop, me, String(body.pullId), body.on === true);
        return json({ ok: true });
      case "list":
        await createListing(db, shop, me, String(body.pullId), Number(body.price));
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
