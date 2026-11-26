// Card Broker Marketing tab ↔ site redeem codes (/internal/site-redeem-codes). Server-to-server only (pairing secret).
// POST {op:"campaigns"} → {campaigns}
// POST {op:"codes", campaign, status?: all|unused|redeemed|voided, q?} → {campaign, codes}
// POST {op:"generate", campaign, count, actor?} → {campaign, batch, codes}
// POST {op:"saveCampaign", campaign:{key, name?, bits?, expiresAt?, active?, note?}} → {key}
// POST {op:"void", codes:[...]} → {voided}
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { brokerActor, cardBrokerAuthorized } from "../site/core/internal-auth.server";
import { RedeemError, generateCodes, listCampaigns, listCodes, saveCampaign, voidCodes } from "../site/promos/redeem-codes.server";

export const loader = () => new Response("Not found", { status: 404 });

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST" || !cardBrokerAuthorized(request)) return Response.json({ error: "Unavailable." }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 80_000) return Response.json({ error: "Too large." }, { status: 413 });
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 422 });
  }
  const headers = { "Cache-Control": "no-store" };
  const actor = (typeof b.actor === "string" ? b.actor.slice(0, 200) : null) ?? brokerActor(request);
  try {
    if (b.op === "campaigns") return Response.json({ campaigns: await listCampaigns(db) }, { headers });
    if (b.op === "codes") return Response.json(await listCodes(db, b.campaign, { status: b.status, q: b.q }), { headers });
    if (b.op === "generate") return Response.json(await generateCodes(db, b.campaign, b.count, actor), { headers });
    if (b.op === "saveCampaign") return Response.json(await saveCampaign(db, (b.campaign ?? {}) as Record<string, unknown>), { headers });
    if (b.op === "void") return Response.json(await voidCodes(db, b.codes), { headers });
  } catch (e) {
    if (e instanceof RedeemError) return Response.json({ error: e.message }, { status: 422, headers });
    throw e;
  }
  return Response.json({ error: "Unknown op." }, { status: 422 });
}
