// POST /api/help: Ask Latch, the AI help chat (see app/site/help/help.server.ts). 404 unless CARDBIT_SITE=on,
// SITE_HELP=on and ANTHROPIC_API_KEY is set. Works on the coming-soon waitlist page too (Trevor, Nov 25 2026),
// so it is NOT behind the waitlist gate; the bot is told which mode the visitor is in.
//   GET                                                   -> { access: {canAsk, adultOnFile} | {canAsk:false, reason} }
//   POST {action:"ask", conversationId?, message, adult}  -> { conversationId, reply, handoff }
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { clientIp, cookieValue, currentCustomer, setCookie } from "../site/core/auth.server";
import { json, sameOriginJson, siteOn } from "../site/store/http.server";
import { gatePass } from "../site/waitlist/gate.server";
import { HelpError, askHelp, hashIp, helpAccess, helpOn, newVisitorToken, visitorKeyOf } from "../site/help/help.server";

const VISITOR_COOKIE = "cb_help";
const off = () => !siteOn() || !helpOn();

export async function loader({ request }: LoaderFunctionArgs) {
  if (off()) return new Response("Not found", { status: 404 });
  const customer = await currentCustomer(db, request);
  return json({ access: await helpAccess(db, customer) });
}

export async function action({ request }: ActionFunctionArgs) {
  if (off()) return new Response("Not found", { status: 404 });
  if (request.method !== "POST" || !sameOriginJson(request)) return json({ error: "Method not allowed." }, 405);
  const raw = await request.text();
  if (raw.length > 4000) return json({ error: "Too large." }, 413);
  let input: { action?: unknown; conversationId?: unknown; message?: unknown; adult?: unknown } | null = null;
  try {
    input = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  if (input?.action !== "ask") return json({ error: "Unknown action." }, 400);

  const customer = await currentCustomer(db, request);
  let token = cookieValue(request, VISITOR_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{16,40}$/.test(token)) token = null;
  const fresh = !customer && !token ? newVisitorToken() : null;
  const visitorKey = visitorKeyOf(customer, token ?? fresh)!;
  const headers = fresh ? { "Set-Cookie": setCookie(VISITOR_COOKIE, fresh, 30 * 86_400) } : undefined;
  const respond = (body: unknown, status = 200) => {
    const r = json(body, status);
    if (headers) r.headers.append("Set-Cookie", headers["Set-Cookie"]);
    return r;
  };
  try {
    const out = await askHelp(db, {
      customer,
      visitorKey,
      ipHash: hashIp(clientIp(request)),
      conversationId: input.conversationId,
      question: input.message,
      adult: input.adult,
      mode: gatePass(request) ? "site" : "waitlist",
    });
    return respond(out);
  } catch (e) {
    if (e instanceof HelpError) return respond({ error: e.message, code: e.code }, e.status);
    throw e;
  }
}
