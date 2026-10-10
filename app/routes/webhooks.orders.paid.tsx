import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { drawForOrder } from "../lib/pool.server";
import { holdOrder, setOpenLinkMetafield, tagOrder } from "../lib/orders.server";
import { packsPageUrl } from "../lib/links.server";

interface OrderPayload {
  admin_graphql_api_id: string;
  name: string;
  customer?: { admin_graphql_api_id?: string } | null;
  line_items: {
    admin_graphql_api_id: string;
    variant_id: number | null;
    quantity: number;
  }[];
}

// The card for every pack is decided here, server-side, the moment payment clears.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin, payload } = await authenticate.webhook(request);
  const order = payload as OrderPayload;

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

  if (!result.packOrder || !admin) return new Response();

  await holdOrder(admin, order.admin_graphql_api_id);
  await db.packOrder.update({
    where: { orderId: order.admin_graphql_api_id },
    data: { held: true },
  });
  await setOpenLinkMetafield(
    admin,
    order.admin_graphql_api_id,
    packsPageUrl(shop, result.packOrder.openToken),
  );

  if (result.shortfall.length > 0) {
    // More packs sold than cards left (should not happen while pack inventory matches the pool).
    console.error(`Order ${order.name}: series sold out before all packs were drawn`, result.shortfall);
    await tagOrder(admin, order.admin_graphql_api_id, ["mystery-pack-sold-out-refund-needed"]);
  }

  return new Response();
};
