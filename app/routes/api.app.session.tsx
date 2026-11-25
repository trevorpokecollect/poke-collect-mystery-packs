// POST /api/app/session {code, verifier} -> {token, expiresAt, state}. iPhone app only.
// The token is a normal site session (cb_site); the app stores it in the Keychain.
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { SESSION_COOKIE, setCookie } from "../site/core/auth.server";
import { HandoffError, redeemHandoff } from "../site/core/app-handoff.server";
import { storeState } from "../site/store/store.server";
import { json, sameOriginJson, siteOn } from "../site/store/http.server";

export const loader = () => new Response("Not found", { status: 404 });

export async function action({ request }: ActionFunctionArgs) {
  if (!siteOn()) return new Response("Not found", { status: 404 });
  if (!sameOriginJson(request)) return json({ error: "Invalid request.", code: "invalid" }, 400);
  let body: { code?: unknown; verifier?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request.", code: "invalid" }, 400);
  }
  try {
    const { token, expiresAt, customer } = await redeemHandoff(db, body.code, body.verifier, request);
    const res = json({ token, expiresAt: expiresAt.toISOString(), state: await storeState(db, customer) });
    res.headers.append("Set-Cookie", setCookie(SESSION_COOKIE, token, Math.floor((expiresAt.getTime() - Date.now()) / 1000)));
    return res;
  } catch (e) {
    if (e instanceof HandoffError) return json({ error: e.message, code: e.code }, 401);
    throw e;
  }
}
