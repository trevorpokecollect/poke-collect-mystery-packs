// Coinflow webhooks for the standalone site. Verified with COINFLOW_WEBHOOK_SECRET
// (Authorization header or Coinflow-Signature HMAC). 404 unless CARDBIT_SITE=on.
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { eventId, handleCoinflowEvent, verifyWebhook, type CoinflowEvent } from "../site/payments/coinflow.server";
import { topupReceiptSender } from "../site/payments/receipts.server";
import { handleCoinflowSubscriptionEvent } from "../site/payments/coinflow-subscriptions.server";

export async function loader() {
  return new Response("Not found", { status: 404 });
}

export async function action({ request }: ActionFunctionArgs) {
  if (process.env.CARDBIT_SITE !== "on") return new Response("Not found", { status: 404 });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const raw = await request.text();
  if (raw.length > 256_000) return new Response("Too large", { status: 413 });
  if (!verifyWebhook(raw, request.headers, process.env.COINFLOW_WEBHOOK_SECRET)) return new Response("Unauthorized", { status: 401 });
  let ev: CoinflowEvent;
  try {
    ev = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const id = eventId(raw);
  const type = String(ev.eventType || "unknown").slice(0, 80);
  const ref = String(ev.data?.id || ev.data?.paymentId || "").slice(0, 120) || null;
  const prior = await db.siteWebhookEvent.findUnique({ where: { id } });
  if (prior?.processedAt) return Response.json({ ok: true, replay: true });
  if (!prior)
    await db.siteWebhookEvent
      .create({ data: { id, provider: "coinflow", eventType: type, ref, payload: ev as object } })
      .catch((e: { code?: string }) => {
        if (e.code !== "P2002") throw e;
      });
  // Cardbit Club: subscription lifecycle and renewal payments go to the subscription handler; refunds
  // and chargebacks try top-ups first, then subscription payments.
  const t = ev.eventType || "";
  const subFirst = t.startsWith("Subscription ") || (t === "Settled" && !ev.data?.webhookInfo?.topupId);
  let result = subFirst ? await handleCoinflowSubscriptionEvent(db, ev) : null;
  if (result === null) result = await handleCoinflowEvent({ db, onCredited: topupReceiptSender() }, ev);
  if (/^ignored:(unknown_payment|no_topup)/.test(result)) result = (await handleCoinflowSubscriptionEvent(db, ev)) ?? result;
  await db.siteWebhookEvent.update({ where: { id }, data: { result, processedAt: new Date() } });
  return Response.json({ ok: true, result });
}
