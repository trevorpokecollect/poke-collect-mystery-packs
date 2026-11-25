// Stripe webhooks for the standalone site's backup top-up processor (test mode unless approved).
// Separate from /webhooks/stripe (production Packs). 404 unless CARDBIT_SITE=on and Stripe is configured.
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { eventId } from "../site/payments/coinflow.server";
import { topupReceiptSender } from "../site/payments/receipts.server";
import { handleSiteStripeEvent, siteStripe, siteStripeConfig } from "../site/payments/stripe-site.server";

export const loader = () => new Response("Not found", { status: 404 });

export async function action({ request }: ActionFunctionArgs) {
  const config = process.env.CARDBIT_SITE === "on" ? siteStripeConfig() : null;
  if (!config) return new Response("Not found", { status: 404 });
  const raw = await request.text();
  const stripe = siteStripe(config);
  let event;
  try {
    event = stripe.webhooks.constructEvent(raw, request.headers.get("stripe-signature") || "", config.webhookSecret);
  } catch {
    return new Response("Bad signature", { status: 400 });
  }
  const id = eventId(`stripe:${event.id}`);
  const prior = await db.siteWebhookEvent.findUnique({ where: { id } });
  if (prior?.processedAt) return Response.json({ ok: true, replay: true });
  if (!prior)
    await db.siteWebhookEvent
      .create({ data: { id, provider: "stripe", eventType: event.type.slice(0, 80), ref: event.id, payload: { id: event.id, type: event.type, livemode: event.livemode } } })
      .catch((e: { code?: string }) => {
        if (e.code !== "P2002") throw e;
      });
  const result = await handleSiteStripeEvent({ db, onCredited: topupReceiptSender() }, stripe, config, event);
  await db.siteWebhookEvent.update({ where: { id }, data: { result, processedAt: new Date() } });
  return Response.json({ ok: true, result });
}
