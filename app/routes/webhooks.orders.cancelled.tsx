import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { voidPulls } from "../lib/pool.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload } = await authenticate.webhook(request);
  const orderId = (payload as { admin_graphql_api_id: string }).admin_graphql_api_id;
  await voidPulls(db, orderId);
  return new Response();
};
