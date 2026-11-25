// Card Broker "Analytics" tab ↔ site. Server-to-server only (pairing secret), read-only.
// POST {view:"overview", from?, to?} → totals, previous period, series, top packs
// POST {view:"live"} → people on the site now, today's totals, recent activity
// POST {view:"traffic", from?, to?} → sessions, sources, devices, places, pages
// POST {view:"funnel" | "sales" | "customers" | "metrics" | "marketing", from?, to?} → funnels + abandoned checkouts; sales by day,
//   product, tier and billing state, refunds, Cardbits owed; buyers, signup methods, top spenders, cohorts
// Dates are inclusive local days (America/Chicago), "YYYY-MM-DD"; default the last 30 days.
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { cardBrokerAuthorized } from "../site/core/internal-auth.server";
import { customers, funnel, live, marketing, metrics, overview, sales, traffic } from "../site/analytics/report.server";

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
  const headers = { "Cache-Control": "no-store" };
  if (b.view === "overview") return Response.json(await overview(db, { from: b.from, to: b.to }), { headers });
  if (b.view === "live") return Response.json(await live(db), { headers });
  if (b.view === "traffic") return Response.json(await traffic(db, { from: b.from, to: b.to }), { headers });
  if (b.view === "funnel") return Response.json(await funnel(db, { from: b.from, to: b.to }), { headers });
  if (b.view === "sales") return Response.json(await sales(db, { from: b.from, to: b.to }), { headers });
  if (b.view === "customers") return Response.json(await customers(db, { from: b.from, to: b.to }), { headers });
  if (b.view === "metrics") return Response.json(await metrics(db, { from: b.from, to: b.to }), { headers });
  if (b.view === "marketing") return Response.json(await marketing(db, { from: b.from, to: b.to }), { headers });
  return Response.json({ error: "Unknown view." }, { status: 422 });
}
