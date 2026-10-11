// The card for every pack is decided here, server-side, the moment payment clears.
// Called from orders/paid, and from orders/create for orders that are created already paid
// (Shopify sends no orders/paid for those). Drawing is idempotent, so both firing is safe.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { drawForOrder } from "./pool.server";
import { setOpenLinkMetafield, shipAtPayment, tagOrder } from "./orders.server";
import { packsPageUrl, storefrontBase } from "./links.server";

export interface OrderPayload {
  admin_graphql_api_id: string;
  name: string;
  financial_status?: string | null;
  checkout_token?: string | null;
  customer?: { admin_graphql_api_id?: string } | null;
  line_items: {
    admin_graphql_api_id: string;
    variant_id: number | null;
    quantity: number;
  }[];
}

export async function handlePaidOrder(shop: string, admin: AdminApiContext | undefined, order: OrderPayload) {
  const result = await drawForOrder(db, {
    shop,
    orderId: order.admin_graphql_api_id,
    orderName: order.name,
    customerId: order.customer?.admin_graphql_api_id ?? null,
    checkoutToken: order.checkout_token ?? null,
    lines: order.line_items
      .filter((l) => l.variant_id)
      .map((l) => ({
        lineItemId: l.admin_graphql_api_id,
        variantId: `gid://shopify/ProductVariant/${l.variant_id}`,
        quantity: l.quantity,
      })),
  });

  if (!result.packOrder || !admin) return;

  // Orders aren't held for opening: the cards go onto the order now and ship normally, so a
  // customer who never opens online (or misses the window) isn't delayed.
  if (!result.packOrder.cardsAddedAt) {
    await setOpenLinkMetafield(
      admin,
      order.admin_graphql_api_id,
      packsPageUrl(await storefrontBase(admin, shop), result.packOrder.openToken),
    );
    await shipAtPayment(db, admin, order.admin_graphql_api_id);
  }

  if (result.shortfall.length > 0) {
    // More packs sold than cards left (should not happen while pack inventory matches the pool).
    console.error(`Order ${order.name}: series sold out before all packs were drawn`, result.shortfall);
    await tagOrder(admin, order.admin_graphql_api_id, ["mystery-pack-sold-out-refund-needed"]);
  }
}
