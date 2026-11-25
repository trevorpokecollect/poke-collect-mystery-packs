// Card Broker "Waitlist" tab ↔ coming-soon signups. Server-to-server only (pairing secret).
// POST {op:"list", q?, phone?:"yes"|"no", offset?, limit?} →
//   {stats:{total, withPhone, emailOnly, claimed, last24h, lastHour, emailSynced}, matched, signups:[{email, phone, textConsent, claimed, source, createdAt}], next}
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { cardBrokerAuthorized } from "../site/core/internal-auth.server";
import { waitlistList } from "../site/waitlist/waitlist.server";

export const loader = () => new Response("Not found", { status: 404 });

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST" || !cardBrokerAuthorized(request)) return Response.json({ error: "Unavailable." }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 4000) return Response.json({ error: "Too large." }, { status: 413 });
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 422 });
  }
  if (b.op !== "list") return Response.json({ error: "Unknown op." }, { status: 422 });
  const q = typeof b.q === "string" ? b.q.slice(0, 120) : undefined;
  const phone = b.phone === "yes" || b.phone === "no" ? b.phone : undefined;
  return Response.json(await waitlistList(db, { q, phone, offset: Number(b.offset) || 0, limit: Number(b.limit) || undefined }), {
    headers: { "Cache-Control": "no-store" },
  });
}
