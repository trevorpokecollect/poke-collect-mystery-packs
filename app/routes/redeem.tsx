// Redeem a Code (standalone site, Trevor 2026-11-26): cardbit.com/redeem, or cardbit.com/redeem?code=PCBF-XXXXXXXX
// from an email. Signed-out visitors sign in (or create an account) and come straight back with the code filled in.
// 404 unless CARDBIT_SITE=on; before launch the waitlist gate applies like every other page.
// Rules: app/site/promos/redeem-codes.server.ts.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { clientIp, currentCustomer } from "../site/core/auth.server";
import { takeToken } from "../site/core/guard.server";
import { esc, htmlResponse, simplePage } from "../site/core/simple-page";
import { RedeemError, compactCode, fmtExpiry, previewCode, redeemCode, type RedeemResult } from "../site/promos/redeem-codes.server";
import { gateApi, gatePage } from "../site/waitlist/gate.server";

const on = () => process.env.CARDBIT_SITE === "on";
const PATH = "/redeem";
// Attempts per account and per IP (right or wrong). Codes are ~40 random bits, so this makes guessing hopeless.
const PER_CUSTOMER = { perMinute: 6, perHour: 20 };
const PER_IP = { perMinute: 12, perHour: 60 };

/** Form posts must come from this site (blocks cross-site posts riding the session cookie). */
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === new URL(request.url).host || host === request.headers.get("x-forwarded-host");
  } catch {
    return false;
  }
}

const num = (n: number) => n.toLocaleString("en-US");
const cleanCode = (raw: string | null) => (raw ?? "").replace(/[^A-Za-z0-9 -]/g, "").slice(0, 40).toUpperCase();

function form(code: string, info: Awaited<ReturnType<typeof previewCode>>, error?: string) {
  const msg = error ? `<p class="err" role="alert">${esc(error)}</p>` : "";
  const what = info
    ? `<div class="sum"><span>${esc(info.name)}</span><b>${num(info.bits)} Cardbits</b></div>
       ${info.expiresAt ? `<p class="fine">Redeem by ${esc(fmtExpiry(info.expiresAt))}.</p>` : ""}`
    : "";
  return simplePage(
    "Redeem a Code",
    `<h1>Redeem a Code</h1><p class="sub">Enter your code to add free Cardbits to your account.</p>${msg}${what}
     <form method="post" novalidate>
       <label for="code">Code</label>
       <input id="code" name="code" value="${esc(code)}" placeholder="PCBF-XXXXXXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" required>
       <button class="btn">Redeem Code</button>
     </form>
     <p class="fine" style="margin-top:18px">One code per account for each promotion. Promotional Cardbits have no cash value and can't be transferred. <a href="/policies#terms">Terms</a></p>`,
    "",
    { back: "/account" },
  );
}

function done(r: RedeemResult) {
  return simplePage(
    "Code Redeemed",
    `<h1>${r.already ? "Already Redeemed" : "Code Redeemed"}</h1>
     <p class="sub">${r.already ? "This code is already on your account." : `${num(r.bits)} Cardbits were added to your balance.`}</p>
     <div class="sum"><span>Code</span><b>${esc(r.code)}</b></div>
     <div class="sum"><span>${esc(r.name)}</span><b>+${num(r.bits)} Cardbits</b></div>
     ${r.expiresAt ? `<div class="sum"><span>Code Expiry</span><b>${esc(fmtExpiry(r.expiresAt))}</b></div>` : ""}
     <p class="fine">These are promotional Cardbits. They don't expire once they're in your balance, have no cash value and show as a bonus in your history.</p>
     <a class="btn" href="/packs">Open a Pack</a>
     <p class="fine" style="margin-top:14px"><a href="/account">Go to My Account</a></p>`,
    "",
    { back: "/account" },
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (!on()) return new Response("Not found", { status: 404 });
  { const gated = gatePage(request); if (gated) return gated; }
  const url = new URL(request.url);
  const code = cleanCode(url.searchParams.get("code"));
  const customer = await currentCustomer(db, request);
  if (!customer) {
    const back = code ? `${PATH}?code=${encodeURIComponent(code)}` : PATH;
    return new Response(null, { status: 303, headers: { Location: `/sign-in?return_to=${encodeURIComponent(back)}`, "Cache-Control": "no-store" } });
  }
  // The deadline is shown for a real code only; nothing about other codes leaks from this page.
  const info = code && takeToken(`redeem-view:${customer.id}`, { perMinute: 10, perHour: 60 }) ? await previewCode(db, code) : null;
  return htmlResponse(form(code, info));
}

export async function action({ request }: ActionFunctionArgs) {
  if (!on()) return new Response("Not found", { status: 404 });
  { const gated = gateApi(request); if (gated) return gated; }
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const customer = await currentCustomer(db, request);
  const fd = await request.formData();
  const code = cleanCode(String(fd.get("code") ?? ""));
  if (!customer) {
    const back = code ? `${PATH}?code=${encodeURIComponent(code)}` : PATH;
    return new Response(null, { status: 303, headers: { Location: `/sign-in?return_to=${encodeURIComponent(back)}` } });
  }
  if (!takeToken(`redeem:c:${customer.id}`, PER_CUSTOMER) || !takeToken(`redeem:ip:${clientIp(request) ?? "?"}`, PER_IP))
    return htmlResponse(form(code, null, "Too Many Tries. Wait a Few Minutes and Try Again."), 429);
  if (!compactCode(code)) return htmlResponse(form(code, null, "Enter Your Code."), 400);
  try {
    const r = await redeemCode(db, customer, code);
    return htmlResponse(done(r));
  } catch (e) {
    if (e instanceof RedeemError) return htmlResponse(form(code, null, e.message), e.status);
    throw e;
  }
}
