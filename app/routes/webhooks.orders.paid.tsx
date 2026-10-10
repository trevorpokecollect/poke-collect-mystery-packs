import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { handlePaidOrder, type OrderPayload } from "../lib/paid-order.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin, payload } = await authenticate.webhook(request);
  await handlePaidOrder(shop, admin, payload as OrderPayload);
  return new Response();
};
