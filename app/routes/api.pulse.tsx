// POST /api/pulse: first-party page-view and "still here" beacons for Card Broker's Analytics tab.
// Accepts text/plain (navigator.sendBeacon) or JSON, at most 2 KB. Always 204.
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { siteOn } from "../site/store/http.server";
import { recordPulse } from "../site/analytics/track.server";

export const loader = () => new Response("Not found", { status: 404 });

export async function action({ request }: ActionFunctionArgs) {
  if (!siteOn() || request.method !== "POST") return new Response("Not found", { status: 404 });
  const headers = new Headers({ "Cache-Control": "no-store" });
  try {
    const raw = await request.text();
    if (raw.length > 2048) return new Response(null, { status: 204, headers });
    const r = await recordPulse(request, JSON.parse(raw), { db });
    for (const c of r.cookies) headers.append("Set-Cookie", c);
  } catch (e) {
    if (!(e instanceof SyntaxError)) console.warn("[pulse] not recorded", (e as Error).message);
  }
  return new Response(null, { status: 204, headers });
}
