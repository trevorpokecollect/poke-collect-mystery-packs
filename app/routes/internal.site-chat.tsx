// Card Broker "Chat" tab ↔ cardbit.com live chat moderation. Server-to-server only (pairing secret).
// POST {op:"list", room?:"main"|"club", show?:"live"|"removed"|"all", q?, offset?, limit?}
//   → {chatOn, muteHours, stats:{last24h, removed24h, chatters24h, activeMutes}, matched, messages, next}
// POST {op:"mutes"} → {mutes:[{customerId, email, until, by, since}]}
// POST {op:"remove"|"restore", id}            POST {op:"mute", id | customerId, hours}
// POST {op:"unmute", customerId}              POST {op:"post", room, body}  (as "Cardbit Staff")
// POST {op:"flags", status?:"open"|"dismissed"|"actioned", offset?, limit?} → {status, ai, stats, items, next}
// POST {op:"resolve", flagIds:[...], decision:"dismiss"|"remove"|"mute"|"ban", hours?}
// POST {op:"ban", id | customerId}             (unban = op "unmute")
// POST {op:"check", body}                      → {filter, ai}  (try a message; nothing is posted or recorded)
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { brokerActor, cardBrokerAuthorized } from "../site/core/internal-auth.server";
import { ChatError } from "../site/play/chat.server";
import { chatDeskBan, chatDeskCheck, chatDeskFlags, chatDeskList, chatDeskMute, chatDeskMutes, chatDeskPost, chatDeskRemove, chatDeskResolve, chatDeskRestore, chatDeskUnmute } from "../site/play/chat-desk.server";

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
  const str = (k: string, max = 120) => (typeof b[k] === "string" ? (b[k] as string).slice(0, max) : undefined);
  const actor = brokerActor(request);
  try {
    const r =
      b.op === "list"
        ? await chatDeskList(db, { room: str("room", 10), show: str("show", 10), q: str("q"), offset: Number(b.offset) || 0, limit: Number(b.limit) || undefined })
        : b.op === "mutes"
        ? await chatDeskMutes(db)
        : b.op === "remove"
        ? await chatDeskRemove(db, b.id, actor)
        : b.op === "restore"
        ? await chatDeskRestore(db, b.id)
        : b.op === "mute"
        ? await chatDeskMute(db, { id: b.id, customerId: b.customerId, hours: b.hours }, actor)
        : b.op === "unmute"
        ? await chatDeskUnmute(db, b.customerId)
        : b.op === "post"
        ? await chatDeskPost(db, b.room, b.body, actor)
        : b.op === "flags"
        ? await chatDeskFlags(db, { status: str("status", 12), offset: Number(b.offset) || 0, limit: Number(b.limit) || undefined })
        : b.op === "resolve"
        ? await chatDeskResolve(db, { flagIds: b.flagIds, decision: b.decision, hours: b.hours }, actor)
        : b.op === "ban"
        ? await chatDeskBan(db, { id: b.id, customerId: b.customerId }, actor)
        : b.op === "check"
        ? await chatDeskCheck(b.body)
        : null;
    if (!r) return Response.json({ error: "Unknown op." }, { status: 422, headers });
    return Response.json(r, { headers });
  } catch (e) {
    if (e instanceof ChatError) return Response.json({ error: e.message }, { status: e.status === 404 ? 404 : 422, headers });
    throw e;
  }
}
