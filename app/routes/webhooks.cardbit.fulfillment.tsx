import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { liveWorkspace } from "../workspace/mode.server";
import { reconcileOrder } from "../workspace/fulfillment.server";
export async function action({ request }: ActionFunctionArgs) {
  const { shop, admin, payload, topic } = await authenticate.webhook(request);
  if (
    !liveWorkspace(shop) ||
    !["FULFILLMENTS_CREATE", "FULFILLMENTS_UPDATE"].includes(topic)
  )
    return new Response();
  const orderId = String(payload.order_id ?? "");
  if (!/^\d+$/.test(orderId)) return new Response(null, { status: 400 });
  if (!admin) return new Response(null, { status: 503 });
  await reconcileOrder(db, admin, "gid://shopify/Order/" + orderId);
  return new Response();
}
