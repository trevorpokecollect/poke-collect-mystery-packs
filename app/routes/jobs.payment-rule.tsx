import type { ActionFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import { setStoreCreditRule } from "../lib/payment-rule.server";

// Staff switch for the "no store credit on Mystery Packs" checkout rule:
// POST /jobs/payment-rule?shop=<shop>&enabled=true|false with the cron secret.
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
    return Response.json(await setStoreCreditRule(admin, url.searchParams.get("enabled") !== "false"));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
};
