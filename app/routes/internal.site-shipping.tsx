// Card Broker Orders page ↔ site shipping desk. Server-to-server only (pairing secret).
// POST {intent, id?, ...} → see brokerShippingAction. Errors: {error} with 404/409/422.
import type { ActionFunctionArgs } from "react-router";
import { brokerActor, cardBrokerAuthorized } from "../site/core/internal-auth.server";
import { brokerShippingAction, BrokerShipError } from "../site/shipping/broker-api.server";
import { siteShippingDeps } from "../site/shipping/wire.server";

export const loader = () => new Response("Not found", { status: 404 });

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST" || !cardBrokerAuthorized(request)) return Response.json({ error: "Unavailable." }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 8000) return Response.json({ error: "Too large." }, { status: 413 });
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 422 });
  }
  if (!b || typeof b !== "object") return Response.json({ error: "Invalid JSON." }, { status: 422 });
  const headers = { "Cache-Control": "no-store" };
  try {
    return Response.json(await brokerShippingAction(siteShippingDeps(), b, brokerActor(request)), { headers });
  } catch (err) {
    if (err instanceof BrokerShipError) return Response.json({ error: err.message }, { status: err.status, headers });
    console.error("[site-shipping] broker action failed", b.intent, err);
    return Response.json({ error: "Something went wrong. Refresh and try again." }, { status: 500, headers });
  }
}
