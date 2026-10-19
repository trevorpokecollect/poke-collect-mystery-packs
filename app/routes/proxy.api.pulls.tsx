import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { availableSeries, pullsForViewer } from "../lib/pool.server";
import { packImages, packProducts } from "../lib/pack-art.server";
import { json, proxyContext } from "../lib/proxy.server";
import { shippingStatuses, shipStatusFor } from "../lib/shipping-status.server";
import { packShelf } from "../lib/shelf.server";
import { FREE_SHIPPING_CARDS, SHIP_FEE } from "../lib/vault.server";
import { hasMarketAccess, listedOnMarket, recentSales } from "../lib/market.server";

// Lists the viewer's packs. Unopened packs never include the card. Card values are
// admin-only, so customers never see a dollar figure next to what they pulled.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, viewer, admin } = await proxyContext(request);
  if (!viewer) return json({ error: "Log in to see your packs." }, 401);

  // Everything after the first query runs at once: this call is on the critical path of My Packs
  // and the account page's My Vault tab.
  const [pulls, live] = await Promise.all([pullsForViewer(db, shop, viewer), availableSeries(db, shop)]);
  const opened = pulls.filter((p) => p.status !== "UNOPENED");
  const vaultOrders = new Set(
    (
      await db.packOrder.findMany({
        where: { orderId: { in: [...new Set(pulls.map((p) => p.orderId))] }, vault: true },
        select: { orderId: true },
      })
    ).map((o) => o.orderId),
  );
  // In the vault: opened on a vault order and not shipping yet.
  const inVault = (p: (typeof pulls)[number]) => p.status === "REVEALED" && vaultOrders.has(p.orderId);
  const pending = opened.find((p) => inVault(p) && p.shipRequest?.status === "PENDING")?.shipRequest ?? null;
  // Vault cards sit in the store, so only cards on their way out need Shopify's fulfillment status.
  const leaving = opened.filter((p) => !inVault(p));
  const [listed, art, products, shipping, market, sales] = await Promise.all([
    // Vault cards up on Vault Market can't ship until they're taken down, so they're shown apart.
    listedOnMarket(db, shop, opened.filter(inVault).map((p) => p.id)),
    packImages(admin, [...new Set(pulls.map((p) => p.series.packProductId))]),
    packProducts(admin, [...new Set([...live.map((l) => l.series.packProductId), ...pulls.map((p) => p.series.packProductId)])]),
    shippingStatuses(admin, [...new Set(leaving.map((p) => p.shipOrderId ?? p.orderId))]),
    // Logged-in customers get a link to the Vault Marketplace once the merchant turns it on.
    hasMarketAccess(db, admin, shop, viewer.customerId),
    // "Your card sold" notices (Vault Market sales in the last 14 days).
    viewer.customerId ? recentSales(db, shop, viewer.customerId) : Promise.resolve([]),
  ]);
  // Seed for "You Might Also Like" (Shopify's storefront product recommendations).
  const seed = live[0]?.series.packProductId ?? pulls[0]?.series.packProductId ?? null;
  return json({
    // Order-link visitors who aren't logged in only see that order; they can log in for the rest.
    signedIn: !!viewer.customerId,
    recommendFrom: seed ? seed.split("/").pop() : null,
    // The theme's own "You Might Also Like" row is rendered for this product (Section Rendering API).
    recommendHandle: seed ? (products.get(seed)?.handle ?? null) : null,
    // Packs on sale right now, for the "Open More Packs?" shelf.
    available: packShelf(live, products),
    // Cards waiting in the vault, and an unpaid shipping invoice if one is open.
    vault: {
      cards: opened.filter((p) => inVault(p) && p.shipRequest?.status !== "PENDING").length,
      fee: SHIP_FEE,
      freeAt: FREE_SHIPPING_CARDS,
      market,
      sales,
      pending: pending ? { cards: opened.filter((p) => p.shipRequestId === pending.id).length, invoiceUrl: pending.invoiceUrl } : null,
    },
    // Unopened multi-card packs show once (opening reveals all their cards); opened cards list one by one.
    packs: pulls.filter((p, i) =>
      p.status !== "UNOPENED" ||
      pulls.findIndex((q) => q.status === "UNOPENED" && q.lineItemId === p.lineItemId && q.packIndex === p.packIndex) === i,
    ).map((p) => ({
      cardsPerPack: p.series.cardsPerPack,
      id: p.id,
      series: p.series.title,
      packImageUrl: art.get(p.series.packProductId) ?? null,
      orderName: p.orderName,
      pulledAt: p.createdAt.toISOString(),
      opened: p.status !== "UNOPENED",
      card:
        p.status === "UNOPENED"
          ? null
          : {
              title: p.slot.card.title,
              tier: p.slot.card.tier,
              imageUrl: p.slot.card.imageUrl,
            },
      // Listed on Vault Market: { sale, trade }. Only for vault cards.
      market: listed.get(p.id) ?? null,
      // preparing | shipped | pickup_preparing | pickup_ready | picked_up, with tracking once shipped.
      shipping:
        p.status === "UNOPENED"
          ? null
          : inVault(p)
            ? { state: p.shipRequest?.status === "PENDING" ? "awaiting_payment" : "vault", tracking: null }
            : shipStatusFor(shipping, p.shipOrderId ?? p.orderId, p.slot.card.variantId),
    })),
  });
};
