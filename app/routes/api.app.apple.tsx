// POST /api/app/apple: native Sign in with Apple from the iPhone app.
// Body {authorizationCode, bundleId, fullName?: {givenName?, familyName?}, age?: boolean}.
// The code is traded with Apple using the app's bundle ID as client_id (same team key as the
// website), so identity comes from Apple's token endpoint, never from the app's word.
// Returns {token, expiresAt, state}, the same shape as POST /api/app/session.
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { SESSION_COOKIE, SignInError, createSessionToken, setCookie, upsertCustomer } from "../site/core/auth.server";
import { recordSignupAge } from "../site/core/age.server";
import { appleAppIds, appleExchange, providerConfigured } from "../site/core/oauth.server";
import { storeState } from "../site/store/store.server";
import { json, siteOn } from "../site/store/http.server";

export const loader = () => new Response("Not found", { status: 404 });

export async function action({ request }: ActionFunctionArgs) {
  if (!siteOn()) return new Response("Not found", { status: 404 });
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json"))
    return json({ error: "Invalid request.", code: "invalid" }, 400);
  if (!providerConfigured("apple")) return json({ error: "Apple sign-in is not set up yet.", code: "unavailable" }, 503);
  const body = (await request.json().catch(() => null)) as {
    authorizationCode?: unknown; bundleId?: unknown; fullName?: { givenName?: unknown; familyName?: unknown }; age?: unknown;
  } | null;
  const code = typeof body?.authorizationCode === "string" ? body.authorizationCode : "";
  const bundleId = typeof body?.bundleId === "string" ? body.bundleId : "";
  if (!code || code.length > 512 || !appleAppIds().includes(bundleId)) return json({ error: "Invalid request.", code: "invalid" }, 400);
  try {
    const { email } = await appleExchange(code, bundleId);
    const name = [body?.fullName?.givenName, body?.fullName?.familyName].filter((x) => typeof x === "string" && x).join(" ").slice(0, 80) || null;
    const customer = await upsertCustomer(db, { email, name });
    if (customer.closedAt) return json({ error: "This account is closed.", code: "closed" }, 403);
    await recordSignupAge(db, customer.id, body?.age === true);
    const { token, expiresAt } = await createSessionToken(db, customer.id, request, "app:");
    const res = json({ token, expiresAt: expiresAt.toISOString(), state: await storeState(db, customer) });
    res.headers.append("Set-Cookie", setCookie(SESSION_COOKIE, token, Math.floor((expiresAt.getTime() - Date.now()) / 1000)));
    return res;
  } catch (e) {
    if (e instanceof SignInError) return json({ error: e.message, code: "sign_in" }, 401);
    throw e;
  }
}
