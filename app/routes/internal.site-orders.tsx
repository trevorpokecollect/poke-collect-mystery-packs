// Card Broker "Orders" and "Customers" tabs ↔ site. Server-to-server only (pairing secret), read-only.
// POST {view:"orders", type?, q?, before?, limit?, demo?:"only"|"hide"} → {orders, next}
// POST {view:"customers", q?, before?, limit?} → {total, customers, next}
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { cardBrokerAuthorized } from "../site/core/internal-auth.server";
import { listCustomers, listOrders } from "../site/core/orders-desk.server";

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
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : undefined);
  const headers = { "Cache-Control": "no-store" };
  if (b.view === "customers") return Response.json(await listCustomers(db, { q: str("q"), before: str("before"), limit: Number(b.limit) || undefined }), { headers });
  if (b.view === undefined || b.view === "orders")
    return Response.json(
      await listOrders(db, { type: str("type"), q: str("q"), before: str("before"), limit: Number(b.limit) || undefined, demo: b.demo === "only" || b.demo === "hide" ? b.demo : undefined }),
      { headers },
    );
  return Response.json({ error: "Unknown view." }, { status: 422 });
}
