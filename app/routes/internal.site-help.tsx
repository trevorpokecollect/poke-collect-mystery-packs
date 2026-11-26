// Card Broker "Help Chat" review ↔ Ask Latch transcripts. Server-to-server only (pairing secret).
// POST {op:"list", q?, handoff?:true, flagged?:true, offset?, limit?} → {stats, matched, conversations, next}
// POST {op:"get", id}                                                 → {id, page, customerId, handoff, flagged, messages:[{role, body, at, model, error}]}
// POST {op:"mark", id, flagged?:boolean, reviewed?:boolean}           → conversation (as "get")
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { brokerActor, cardBrokerAuthorized } from "../site/core/internal-auth.server";
import { HelpError, helpConversation, helpList, helpMark } from "../site/help/help.server";

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
  try {
    if (b.op === "list")
      return Response.json(
        await helpList(db, {
          q: typeof b.q === "string" ? b.q.trim().slice(0, 120) || undefined : undefined,
          handoff: b.handoff === true,
          flagged: b.flagged === true,
          offset: Number(b.offset) || 0,
          limit: Number(b.limit) || undefined,
        }),
        { headers },
      );
    if (b.op === "get") return Response.json(await helpConversation(db, b.id), { headers });
    if (b.op === "mark") return Response.json(await helpMark(db, brokerActor(request), b.id, { flagged: b.flagged, reviewed: b.reviewed }), { headers });
    return Response.json({ error: "Unknown op." }, { status: 422 });
  } catch (e) {
    if (e instanceof HelpError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
