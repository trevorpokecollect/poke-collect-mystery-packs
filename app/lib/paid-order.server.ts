// The card for every pack is decided here, server-side, the moment payment clears.
// Called from orders/paid, and from orders/create for orders that are created already paid
// (Shopify sends no orders/paid for those). Drawing is idempotent, so both firing is safe.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { drawForOrder } from "./pool.server";
import { holdOrder, setOpenLinkMetafield, tagOrder } from "./orders.server";
import { packsPageUrl, storefrontBase } from "./links.server";

export interface OrderPayload {
  admin_graphql_api_id: string;
  name: string;
  financial_status?: string | null;
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
    lines: order.line_items
      .filter((l) => l.variant_id)
      .map((l) => ({
        lineItemId: l.admin_graphql_api_id,
        variantId: `gid://shopify/ProductVariant/${l.variant_id}`,
        quantity: l.quantity,
      })),
  });

  if (!result.packOrder || !admin) return;

  if (!result.packOrder.held) {
    await holdOrder(admin, order.admin_graphql_api_id);
    await db.packOrder.update({
      where: { orderId: order.admin_graphql_api_id },
      data: { held: true },
    });
    await setOpenLinkMetafield(
      admin,
      order.admin_graphql_api_id,
      packsPageUrl(await storefrontBase(admin, shop), result.packOrder.openToken),
    );
  }

  if (result.shortfall.length > 0) {
    // More packs sold than cards left (should not happen while pack inventory matches the pool).
    console.error(`Order ${order.name}: series sold out before all packs were drawn`, result.shortfall);
    await tagOrder(admin, order.admin_graphql_api_id, ["mystery-pack-sold-out-refund-needed"]);
  }
}
