// EasyPost tracker.updated webhook for the standalone site (backup label provider).
// Register in EasyPost (Account Settings → Webhooks, Test mode first) as:
//   https://<site origin>/site/webhooks/easypost?token=<EASYPOST_WEBHOOK_TOKEN>
// and, optionally, give the webhook a secret and set the same value as EASYPOST_WEBHOOK_SECRET:
// then the X-Hmac-Signature header is checked too. Either way the handler re-reads tracking
// from EasyPost before changing anything.

import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { easypostSignatureOk } from "../site/shipping/easypost.server";
import { handleEasyPostWebhook } from "../site/shipping/service.server";
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
  if (!tokenOk(token, process.env.EASYPOST_WEBHOOK_TOKEN)) return new Response("Unauthorized", { status: 401 });
  const raw = await request.text();
  const secret = process.env.EASYPOST_WEBHOOK_SECRET;
  if (secret && !easypostSignatureOk(raw, request.headers.get("x-hmac-signature"), secret))
    return new Response("Unauthorized", { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  try {
    const result = await handleEasyPostWebhook(siteShippingDeps(process.env, "easypost"), body);
    return Response.json(result);
  } catch (err) {
    console.error("[site-shipping] easypost webhook failed", err);
    // Non-2xx makes EasyPost retry later.
    return new Response("Retry", { status: 500 });
  }
}
