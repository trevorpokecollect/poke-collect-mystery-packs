import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ordersReadyToFinalize, voidPulls } from "../lib/pool.server";
import { finalizeOrder, releaseHolds } from "../lib/orders.server";

interface RefundPayload {
  order_id: number;
  refund_line_items: { quantity: number; line_item: { admin_graphql_api_id: string } }[];
}

// Refunding a pack voids its pull. Voided cards are not resold in the series.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload } = await authenticate.webhook(request);
  const refund = payload as RefundPayload;
  const orderId = `gid://shopify/Order/${refund.order_id}`;

  const perLine = new Map<string, number>();
  for (const item of refund.refund_line_items) {
    const id = item.line_item.admin_graphql_api_id;
    perLine.set(id, (perLine.get(id) ?? 0) + item.quantity);
  }
  const voided = await voidPulls(db, orderId, perLine);
  if (voided.length === 0 || !admin) return new Response();

  // The refund may have removed the last unopened pack, or every pack.
  const live = await db.pull.count({ where: { orderId, status: { in: ["UNOPENED", "REVEALED"] } } });
  if (live === 0) {
    await releaseHolds(admin, orderId);
  } else if ((await ordersReadyToFinalize(db, [orderId])).length > 0) {
    await finalizeOrder(db, admin, orderId);
  }
  return new Response();
};
