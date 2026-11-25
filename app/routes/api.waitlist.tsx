// POST /api/waitlist: coming-soon signup (app/site/waitlist/waitlist.server.ts). Open whether or not the
// coming-soon gate is on, so the form keeps working through launch day.
// Body: { email, emailConsent: true, phone?, smsConsent?, company? (honeypot), source? {utm_*, referrer} }
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { clientIp } from "../site/core/auth.server";
import { json, sameOriginJson, siteOn } from "../site/store/http.server";
import { FOUNDING_TOTAL, WaitlistError, joinWaitlist } from "../site/waitlist/waitlist.server";

export const loader = () => new Response("Not found", { status: 404 });

export async function action({ request }: ActionFunctionArgs) {
  if (!siteOn()) return new Response("Not found", { status: 404 });
  if (request.method !== "POST" || !sameOriginJson(request)) return json({ error: "Method not allowed." }, 405);
  const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!input) return json({ error: "Enter a Valid Email Address." }, 400);
  try {
    const r = await joinWaitlist(db, input, { ip: clientIp(request), userAgent: request.headers.get("user-agent") });
    const message =
      r.status === "already" ? "You're Already on the List. Your Founding Collector Spot Is Saved."
      : r.status === "updated" ? "Phone Number Added to Your Founding Collector Spot."
      : "You're In. Welcome, Founding Collector.";
    return json({ ok: true, ...r, bonus: FOUNDING_TOTAL, message, ...(r.phoneTaken ? { note: "That Phone Number Is Already on the List, So We Saved Your Email Only." } : {}) });
  } catch (e) {
    if (e instanceof WaitlistError) return json({ error: e.message, code: e.code }, e.status);
    throw e;
  }
}
