import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { availableSeries, pullsForViewer } from "../lib/pool.server";
import { packImages, packProducts } from "../lib/pack-art.server";
import { json, proxyContext } from "../lib/proxy.server";
import { shippingStatuses, shipStatusFor } from "../lib/shipping-status.server";

// Lists the viewer's packs. Unopened packs never include the card. Card values are
// admin-only, so customers never see a dollar figure next to what they pulled.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, viewer, admin } = await proxyContext(request);
  if (!viewer) return json({ error: "Log in to see your packs." }, 401);

  const [pulls, live] = await Promise.all([pullsForViewer(db, shop, viewer), availableSeries(db, shop)]);
  const opened = pulls.filter((p) => p.status !== "UNOPENED");
  const [art, products, shipping] = await Promise.all([
    packImages(admin, [...new Set(pulls.map((p) => p.series.packProductId))]),
    packProducts(admin, [...new Set(live.map((l) => l.series.packProductId))]),
    shippingStatuses(admin, [...new Set(opened.map((p) => p.orderId))]),
  ]);
  // Seed for "You Might Also Like" (Shopify's storefront product recommendations).
  const seed = live[0]?.series.packProductId ?? pulls[0]?.series.packProductId ?? null;
  return json({
    // Order-link visitors who aren't logged in only see that order; they can log in for the rest.
    signedIn: !!viewer.customerId,
    recommendFrom: seed ? seed.split("/").pop() : null,
    // Packs on sale right now, for the "Open More Packs?" shelf.
    available: live.flatMap(({ series, packsLeft }) => {
      const product = products.get(series.packProductId);
      if (!product) return [];
      return [{
        series: series.title,
        title: product.title,
        url: `/products/${product.handle}`,
        // Checkout link for one pack, straight past the cart.
        buyUrl: `/cart/${series.packVariantId.split("/").pop()}:1`,
        imageUrl: product.imageUrl,
        price: series.packPrice.toString(),
        packsLeft,
      }];
    }),
    packs: pulls.map((p) => ({
      id: p.id,
      series: p.series.title,
      packImageUrl: art.get(p.series.packProductId) ?? null,
      orderName: p.orderName,
      opened: p.status !== "UNOPENED",
      card:
        p.status === "UNOPENED"
          ? null
          : {
              title: p.slot.card.title,
              tier: p.slot.card.tier,
              imageUrl: p.slot.card.imageUrl,
            },
      // preparing | shipped | pickup_ready | picked_up, with tracking once shipped.
      shipping: p.status === "UNOPENED" ? null : shipStatusFor(shipping, p.orderId, p.slot.card.variantId),
    })),
  });
};
