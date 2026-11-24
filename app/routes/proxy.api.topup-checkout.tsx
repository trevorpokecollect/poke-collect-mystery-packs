import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { walletAccess } from "../lib/cardbits.server";
import { json, proxyContext } from "../lib/proxy.server";
import { createTopupCheckout, stripeClient, stripeConfig } from "../lib/payments/stripe.server";

// POST { variant } → { clientSecret, publishableKey } for Stripe embedded Checkout.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, viewer } = await proxyContext(request);
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!viewer?.customerId) return json({ error: "Sign in to Cardbit." }, 401);
  const config = stripeConfig(shop);
  if (!config || !walletAccess(shop, viewer.customerId))
    return json({ error: "Cardbits top-ups are not available yet." }, 404);
  const input = await request.json().catch(() => null);
  const variant = typeof input?.variant === "string" ? input.variant : "";
  const checkout = await createTopupCheckout(stripeClient(config), config, shop, viewer.customerId, variant);
  if (!checkout) return json({ error: "Choose a Cardbits package." }, 400);
  return json(checkout);
};

// GET ?session_id=cs_… → the signed-in customer's own Checkout status, for the return page.
// Display only: Cardbits are credited by the Stripe webhook, never here.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, viewer } = await proxyContext(request);
  if (!viewer?.customerId) return json({ error: "Sign in to Cardbit." }, 401);
  const config = stripeConfig(shop);
  const id = new URL(request.url).searchParams.get("session_id") ?? "";
  if (!config || !/^cs_(test|live)_\w+$/.test(id)) return json({ error: "Not found." }, 404);
  const session = await stripeClient(config).checkout.sessions.retrieve(id).catch(() => null);
  if (!session || session.metadata?.customer !== viewer.customerId || session.metadata?.shop !== shop)
    return json({ error: "Not found." }, 404);
  const paymentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const credited = paymentId
    ? !!(await db.cardbitReceipt.findUnique({
        where: { shop_eventKey: { shop, eventKey: "fund:stripe:" + paymentId } },
        select: { id: true },
      }))
    : false;
  return json({ status: session.status, paid: session.payment_status === "paid", credited });
};
