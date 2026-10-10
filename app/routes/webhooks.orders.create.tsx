import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { handlePaidOrder, type OrderPayload } from "../lib/paid-order.server";

// Orders created already paid (draft orders marked paid, imports, the Admin API) never get
// an orders/paid webhook, so draw for them here. Unpaid orders wait for orders/paid.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin, payload } = await authenticate.webhook(request);
  const order = payload as OrderPayload;
  if (order.financial_status === "paid") await handlePaidOrder(shop, admin, order);
  return new Response();
};
