import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enabled } from "../workspace/mode.server";
import { campaignOrders } from "../giveaway/campaign-purchases.server";
import type { OrderWebhookPayload } from "../giveaway/legacy/app/lib/entries/orders.server";
export async function action({ request }: ActionFunctionArgs) {
  const { shop, topic, payload } = await authenticate.webhook(request);
  if (enabled(shop))
    await campaignOrders(shop, topic, payload as OrderWebhookPayload);
  return new Response(null, { status: 204 });
}
