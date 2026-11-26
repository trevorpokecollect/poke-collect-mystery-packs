// GET/POST /api/chat: Cardbit site live chat (see app/site/play/chat.server.ts). 404 unless
// CARDBIT_SITE=on and SITE_CHAT=on.
//   GET ?room=main|club            -> { access, messages }
//   POST {action:"send", room, body, replyTo?}   (replyTo = a message id in the same room)
//   POST {action:"delete", id}               (staff)
//   POST {action:"mute", id, hours}          (staff; mutes the message's author)
//   POST {action:"report", id, reason}       (any reader, someone else's message; see chat-moderation.server.ts)
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { json, sameOriginJson, siteOn } from "../site/store/http.server";
import { ChatError, MUTE_HOURS, chatAccess, chatOn, deleteMessage, isRoom, listMessages, markSeen, muteAuthor, onlineCounts, sendMessage } from "../site/play/chat.server";
import { gateApi } from "../site/waitlist/gate.server";
import { ReportError, reportMessage } from "../site/play/chat-moderation.server";

const off = () => !siteOn() || !chatOn();

async function view(customer: Awaited<ReturnType<typeof currentCustomer>>, room: unknown) {
  const r = isRoom(room) ? room : "main";
  const access = await chatAccess(db, customer);
  const messages = await listMessages(db, access, r, customer?.id);
  if (access.canRead && customer) markSeen(customer.id, r);
  return {
    room: r,
    online: access.canRead ? onlineCounts() : null,
    access: access.canRead
      ? { canRead: true, staff: access.staff, club: access.club, mutedUntil: access.mutedUntil?.toISOString() ?? null, muteHours: access.staff ? MUTE_HOURS : undefined }
      : access,
    messages,
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (off()) return new Response("Not found", { status: 404 });
  { const gated = gateApi(request); if (gated) return gated; }
  const customer = await currentCustomer(db, request);
  return json(await view(customer, new URL(request.url).searchParams.get("room")));
}

export async function action({ request }: ActionFunctionArgs) {
  if (off()) return new Response("Not found", { status: 404 });
  { const gated = gateApi(request); if (gated) return gated; }
  if (request.method !== "POST" || !sameOriginJson(request)) return json({ error: "Method not allowed." }, 405);
  const customer = await currentCustomer(db, request);
  if (!customer) return json({ error: "Sign In to chat.", code: "sign_in" }, 401);
  const input = (await request.json().catch(() => null)) as { action?: unknown; room?: unknown; body?: unknown; id?: unknown; hours?: unknown; replyTo?: unknown; reason?: unknown } | null;
  try {
    if (input?.action === "send") {
      if (!isRoom(input.room)) return json({ error: "Choose a room." }, 400);
      await sendMessage(db, customer, input.room, input.body, process.env, input.replyTo);
      return json(await view(customer, input.room));
    }
    if (input?.action === "delete") {
      await deleteMessage(db, customer, input.id);
      return json(await view(customer, input.room));
    }
    if (input?.action === "mute") {
      await muteAuthor(db, customer, input.id, input.hours);
      return json(await view(customer, input.room));
    }
    if (input?.action === "report") {
      const access = await chatAccess(db, customer);
      if (!access.canRead || !isRoom(input.room) || (input.room === "club" && !access.club)) return json({ error: "You can't use chat right now." }, 403);
      const r = await reportMessage(db, customer.id, input.room, input.id, input.reason);
      return json({ ...(await view(customer, input.room)), reported: true, hidden: r.hidden });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    if (e instanceof ChatError || e instanceof ReportError) return json({ error: e.message, code: e.code }, e.status);
    throw e;
  }
}
