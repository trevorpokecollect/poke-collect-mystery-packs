// Coming-soon gate (Trevor, Nov 25 2026): until launch the waitlist replaces cardbit.com for the public.
// On when CARDBIT_WAITLIST=on (app-site). Staff open https://cardbit.com/?preview=<CARDBIT_PREVIEW_KEY> once
// per browser; that sets a signed cookie (30 days) and the full site works as normal. ?preview=off clears it.
// Policies, Official Rules, Verified Shuffle, webhooks, staff/internal routes and sign-in callbacks are never gated.
// Browse pages (How It Works, Packs, Shop, Cardbits) and the read-only catalog are open to everyone so payment
// reviewers can see what is sold (Trevor, Nov 26 2026); buying, top-ups, sign-in and account pages stay gated.
import { createHmac, timingSafeEqual } from "node:crypto";
import { waitlistOn } from "./waitlist.server";
import { cookieValue } from "../core/auth.server";

export const PREVIEW_COOKIE = "cb_preview";
/** First path segments anyone may browse in coming-soon mode. */
export const BROWSE_BASES = new Set(["help", "packs", "shop", "cardbits"]);
const MAX_AGE = 30 * 24 * 3600;

const previewKey = (env: NodeJS.ProcessEnv = process.env) => {
  const k = (env.CARDBIT_PREVIEW_KEY || "").trim();
  return k.length >= 16 ? k : null; // too short to be a secret: nobody gets in by link
};
const token = (key: string) => createHmac("sha256", key).update("cardbit-preview-v1").digest("base64url");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const secure = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");

/** True when this request may see the full site. */
export function gatePass(request: Request, env: NodeJS.ProcessEnv = process.env) {
  if (!waitlistOn(env)) return true;
  const key = previewKey(env);
  const c = cookieValue(request, PREVIEW_COOKIE);
  return !!(key && c && same(c, token(key)));
}

/** ?preview=<key> sets the staff cookie; ?preview=off removes it. Returns the redirect, or null. */
export function previewRedirect(request: Request, env: NodeJS.ProcessEnv = process.env): Response | null {
  const url = new URL(request.url);
  const given = url.searchParams.get("preview");
  if (given === null) return null;
  url.searchParams.delete("preview");
  const to = url.pathname + (url.search || "");
  const key = previewKey(env);
  if (given === "off")
    return new Response(null, { status: 302, headers: { Location: to, "Set-Cookie": `${PREVIEW_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`, "Cache-Control": "no-store" } });
  if (!key || !same(given, key)) return new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store" } });
  return new Response(null, {
    status: 302,
    headers: { Location: to, "Set-Cookie": `${PREVIEW_COOKIE}=${token(key)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure()}`, "Cache-Control": "no-store" },
  });
}

/** For customer pages other than "/": send the public to the waitlist. */
export function gatePage(request: Request): Response | null {
  const preview = previewRedirect(request);
  if (preview) return preview;
  if (gatePass(request)) return null;
  return new Response(null, { status: 302, headers: { Location: "/", "Cache-Control": "no-store" } });
}

/** For customer APIs: refuse while the site is in coming-soon mode. */
export function gateApi(request: Request): Response | null {
  if (gatePass(request)) return null;
  return new Response(JSON.stringify({ error: "Cardbit Is Launching Soon. Join the Waitlist at cardbit.com.", code: "waitlist" }), {
    status: 403,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
