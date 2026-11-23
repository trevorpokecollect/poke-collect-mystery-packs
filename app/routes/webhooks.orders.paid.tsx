import {campaignOrders} from "../giveaway/campaign-purchases.server";
import type {OrderWebhookPayload} from "../giveaway/legacy/app/lib/entries/orders.server";
import db from "../db.server";
import {checkPurchase} from "../giveaway/purchases.server";
import {enabled} from "../workspace/mode.server";
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { handlePaidOrder, type OrderPayload } from "../lib/paid-order.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin, payload } = await authenticate.webhook(request);
  await handlePaidOrder(shop, admin, payload as OrderPayload);
  const order=payload as OrderPayload;
  if(enabled(shop) && admin && !order.test) await checkPurchase(db,admin,shop,order.admin_graphql_api_id,order.customer?.admin_graphql_api_id);
  if(enabled(shop)) await campaignOrders(shop,"ORDERS_PAID",payload as OrderWebhookPayload);
  return new Response();
};
