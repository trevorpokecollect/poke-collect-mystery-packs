// Shared route handlers for /auth/{discord,apple} and their callbacks.
import db from "../../db.server";
import { SignInError, createSession } from "./auth.server";
import { recordSignupAge } from "./age.server";
import { oauthFinish, oauthStart, type OAuthProvider } from "./oauth.server";

const on = () => process.env.CARDBIT_SITE === "on";
const back = (msg: string) => new Response(null, { status: 303, headers: { Location: `/?signin_error=${encodeURIComponent(msg)}` } });

export function startRoute(p: OAuthProvider, request: Request) {
  if (!on()) return new Response("Not found", { status: 404 });
  const q = new URL(request.url).searchParams;
  try {
    const { url, cookie } = oauthStart(p, q.get("return_to") || "/account", { age: q.get("age") === "1" });
    return new Response(null, { status: 303, headers: { Location: url, "Set-Cookie": cookie } });
  } catch (e) {
    return back(e instanceof SignInError ? e.message : "That sign-in option is unavailable.");
  }
}

export async function callbackRoute(p: OAuthProvider, request: Request, params: URLSearchParams) {
  if (!on()) return new Response("Not found", { status: 404 });
  try {
    const { customer, returnTo, age, clearState } = await oauthFinish(db, p, request, params);
    await recordSignupAge(db, customer.id, age);
    const session = await createSession(db, customer.id, request);
    const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    headers.append("Set-Cookie", session);
    headers.append("Set-Cookie", clearState);
    // Continue with a same-site navigation (Apple arrives by cross-site POST).
    const to = JSON.stringify(returnTo).replace(/</g, "\\u003c");
    return new Response(
      `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${returnTo.replace(/"/g, "&quot;")}"><script>location.replace(${to})</script>`,
      { status: 200, headers },
    );
  } catch (e) {
    if (!(e instanceof SignInError)) console.error(`${p} callback failed`, e);
    return back(e instanceof SignInError ? e.message : "Sign-in failed. Please try again.");
  }
}
