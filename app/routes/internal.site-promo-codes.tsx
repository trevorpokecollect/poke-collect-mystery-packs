// Card Broker Marketing tab ↔ site promo codes (/internal/site-promo-codes). Server-to-server only (pairing secret).
// POST {op:"list"} → {codes}
// POST {op:"save", promo:{code, kind, value, maxBonusBits?, maxUses?, minCents?, firstTopupOnly?, startsAt?, endsAt?, active?, note?}, actor?} → {code}
// POST {op:"setActive", code, active} → {code}
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { cardBrokerAuthorized } from "../site/core/internal-auth.server";
import { PromoCodeError, listPromos, savePromo, setPromoActive, type PromoInput } from "../site/promos/promo-codes.server";

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
  const headers = { "Cache-Control": "no-store" };
  try {
    if (b.op === "list") return Response.json({ codes: await listPromos(db) }, { headers });
    if (b.op === "save") {
      const actor = typeof b.actor === "string" ? b.actor.slice(0, 200) : null;
      const saved = await savePromo(db, (b.promo ?? {}) as PromoInput, actor);
      return Response.json({ code: saved.code }, { headers });
    }
    if (b.op === "setActive") {
      const saved = await setPromoActive(db, b.code, b.active === true);
      return Response.json({ code: saved.code }, { headers });
    }
  } catch (e) {
    if (e instanceof PromoCodeError) return Response.json({ error: e.message }, { status: 422, headers });
    throw e;
  }
  return Response.json({ error: "Unknown op." }, { status: 422 });
}
