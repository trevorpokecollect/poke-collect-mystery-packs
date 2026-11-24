import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { CARDBIT_SHOP } from "../lib/cardbit.server";
import { handleStripeEvent, stripeClient, stripeConfig } from "../lib/payments/stripe.server";

// Stripe calls this for Cardbits top-ups. The raw body is verified with the endpoint's signing
// secret before anything is read; unsigned or foreign requests change nothing.
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const config = stripeConfig(CARDBIT_SHOP);
  if (!config) return new Response(null, { status: 404 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response(null, { status: 400 });
  const stripe = stripeClient(config);
  let event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, config.webhookSecret);
  } catch {
    return new Response(null, { status: 400 });
  }
  // A thrown error returns 500 so Stripe retries; every handler is idempotent.
  const result = await handleStripeEvent(db, stripe, config, CARDBIT_SHOP, event);
  return Response.json({ received: true, result });
};
