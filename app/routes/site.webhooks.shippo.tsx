// Shippo track_updated webhook for the standalone site.
// Register in Shippo (API configuration → Webhooks) as:
//   https://<site origin>/site/webhooks/shippo?token=<SHIPPO_WEBHOOK_TOKEN>
// Shippo doesn't sign webhooks, so the URL token gates the call and the handler re-reads
// tracking from Shippo before changing anything.

import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { handleTrackingWebhook } from "../site/shipping/service.server";
import { siteEnabled, siteShippingDeps } from "../site/shipping/wire.server";

function tokenOk(given: string | null, expected: string | undefined) {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function loader() {
  return new Response("Not found", { status: 404 });
}

export async function action({ request }: ActionFunctionArgs) {
  if (!siteEnabled()) return new Response("Not found", { status: 404 });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const token = new URL(request.url).searchParams.get("token");
  if (!tokenOk(token, process.env.SHIPPO_WEBHOOK_TOKEN)) return new Response("Unauthorized", { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  try {
    const result = await handleTrackingWebhook(siteShippingDeps(), body);
    return Response.json(result);
  } catch (err) {
    console.error("[site-shipping] webhook failed", err);
    // 500 makes Shippo retry later.
    return new Response("Retry", { status: 500 });
  }
}
