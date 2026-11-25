// Card Broker "Customers" tab ↔ site customer records (Shopify-style). Server-to-server only (pairing secret).
// POST {op:"list", q?, email?, sms?, tag?, buyer?, status?, club?, sort?, offset?, limit?} → {total, matched, counts, tags, customers, next}
// POST {op:"get", id} → full record (consent with dates and source, tags, note, addresses, orders, first visit)
// POST {op:"update", id, tags?, note?, unsubscribe?:"email"|"sms"} → updated record (staff never subscribe anyone)
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { cardBrokerAuthorized } from "../site/core/internal-auth.server";
import { RecordError, customerRecord, listCustomerRecords, updateCustomerRecord } from "../site/core/customer-records.server";

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
  const str = (k: string, max = 120) => (typeof b[k] === "string" ? (b[k] as string).slice(0, max) : undefined);
  const headers = { "Cache-Control": "no-store" };
  try {
    if (b.op === "list")
      return Response.json(
        await listCustomerRecords(db, {
          q: str("q"), email: str("email", 20), sms: str("sms", 20), tag: str("tag", 40), buyer: str("buyer", 5), status: str("status", 20),
          club: str("club", 5), sort: str("sort", 20), offset: Number(b.offset) || 0, limit: Number(b.limit) || undefined,
        }),
        { headers },
      );
    const id = str("id", 64);
    if (!id) return Response.json({ error: "Customer id required." }, { status: 422 });
    if (b.op === "get") {
      const r = await customerRecord(db, id);
      return r ? Response.json(r, { headers }) : Response.json({ error: "No such customer." }, { status: 404 });
    }
    if (b.op === "update") return Response.json(await updateCustomerRecord(db, id, { tags: b.tags, note: b.note, unsubscribe: b.unsubscribe }), { headers });
  } catch (e) {
    if (e instanceof RecordError) return Response.json({ error: e.message }, { status: 422, headers });
    throw e;
  }
  return Response.json({ error: "Unknown op." }, { status: 422 });
}
