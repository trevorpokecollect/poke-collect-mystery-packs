import type { ActionFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import { setVaultDeliveryRule } from "../lib/delivery-rule.server";

// Staff switch for the "Keep In My Vault" checkout rule (singles-only carts, logged in):
// POST /jobs/delivery-rule?shop=<shop>&enabled=true|false with the cron secret.
export const action = async ({ request }: ActionFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) return Response.json({ error: "shop is required" }, { status: 400 });
  try {
    const { admin } = await unauthenticated.admin(shop);
    return Response.json(await setVaultDeliveryRule(admin, url.searchParams.get("enabled") !== "false"));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
};
