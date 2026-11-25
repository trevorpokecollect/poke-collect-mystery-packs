// Standalone-site sign-in: Google or a 6-digit email code. 404 unless CARDBIT_SITE=on.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import {
  SignInError,
  clientIp,
  createSession,
  currentCustomer,
  issueEmailCode,
  safeReturn,
  verifyEmailCode,
} from "../site/core/auth.server";
import { sendEmail } from "../site/email/outbox.server";
import { mailerFromEnv } from "../site/email/mailer.server";
import { protectionScript } from "../site/payments/coinflow.server";

const on = () => process.env.CARDBIT_SITE === "on";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(o: { returnTo: string; step: "email" | "code"; email?: string; error?: string; note?: string }) {
  const rt = esc(o.returnTo);
  const err = o.error ? `<p class="err" role="alert">${esc(o.error)}</p>` : "";
  const note = o.note ? `<p class="note" role="status">${esc(o.note)}</p>` : "";
  const body =
    o.step === "email"
      ? `<a class="btn g" href="/auth/google?return_to=${encodeURIComponent(o.returnTo)}">Continue With Google</a>
         <div class="or"><span>or</span></div>
         <form method="post"><input type="hidden" name="intent" value="send"><input type="hidden" name="return_to" value="${rt}">
         <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required value="${esc(o.email || "")}">
         <button class="btn" type="submit">Email Me A Code</button></form>`
      : `<form method="post"><input type="hidden" name="intent" value="verify"><input type="hidden" name="return_to" value="${rt}">
         <input type="hidden" name="email" value="${esc(o.email || "")}">
         <label for="code">6-digit code sent to ${esc(o.email || "")}</label>
         <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required autofocus>
         <button class="btn" type="submit">Sign In</button></form>
         <form method="post"><input type="hidden" name="intent" value="send"><input type="hidden" name="return_to" value="${rt}">
         <input type="hidden" name="email" value="${esc(o.email || "")}"><button class="link" type="submit">Send A New Code</button></form>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign In · Cardbit</title><meta name="robots" content="noindex">${protectionScript()}
<style>
:root{--bg:#17213B;--panel:#1f2b4a;--ink:#FAF8F3;--muted:#c7cbd6;--cobalt:#4057F5;--apricot:#FFB65C;--err:#ff8a80}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 "Atkinson Hyperlegible Next","Atkinson Hyperlegible",system-ui,sans-serif;padding:16px}
main{width:100%;max-width:400px;background:var(--panel);border-radius:16px;padding:28px}
h1{font:800 1.75rem/1.2 Outfit,system-ui,sans-serif;margin:0 0 4px}p.sub{color:var(--muted);margin:0 0 20px}
label{display:block;font-weight:700;margin:14px 0 6px}input{width:100%;padding:12px;border-radius:10px;border:1px solid #3a4870;background:#111a30;color:var(--ink);font-size:1rem}
.btn{display:block;width:100%;text-align:center;margin-top:14px;padding:12px;border:0;border-radius:10px;background:var(--cobalt);color:#fff;font:800 1rem Outfit,system-ui,sans-serif;text-decoration:none;cursor:pointer}
.btn.g{background:var(--ink);color:var(--bg)}.or{display:flex;align-items:center;gap:10px;color:var(--muted);margin:18px 0 0}.or:before,.or:after{content:"";flex:1;height:1px;background:#3a4870}
.link{background:none;border:0;color:var(--apricot);padding:0;margin-top:14px;cursor:pointer;font:inherit;text-decoration:underline}
.err{color:var(--err)}.note{color:var(--apricot)}:focus-visible{outline:3px solid var(--apricot);outline-offset:2px}
</style></head><body><main><h1>Sign In To Cardbit</h1><p class="sub">New here? Signing in creates your account.</p>${err}${note}${body}</main></body></html>`;
}
const html = (s: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(s, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers } });

export async function loader({ request }: LoaderFunctionArgs) {
  if (!on()) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const returnTo = safeReturn(url.searchParams.get("return_to"));
  if (await currentCustomer(db, request)) return Response.redirect(new URL(returnTo, url).toString(), 303);
  return html(page({ returnTo, step: "email", error: url.searchParams.get("error") || undefined }));
}

export async function action({ request }: ActionFunctionArgs) {
  if (!on()) return new Response("Not found", { status: 404 });
  const f = await request.formData();
  const returnTo = safeReturn(String(f.get("return_to") || ""));
  const email = String(f.get("email") || "").slice(0, 254);
  try {
    if (f.get("intent") === "send") {
      const issued = await issueEmailCode(db, email, clientIp(request));
      await sendEmail({ db, mailer: mailerFromEnv() }, "signin_code", issued.email, { code: issued.code, minutes: 10 }, issued.id);
      return html(page({ returnTo, step: "code", email: issued.email, note: "We emailed you a 6-digit code." }));
    }
    const customer = await verifyEmailCode(db, email, String(f.get("code") || ""));
    const cookie = await createSession(db, customer.id, request);
    return new Response(null, { status: 303, headers: { Location: returnTo, "Set-Cookie": cookie } });
  } catch (e) {
    if (!(e instanceof SignInError)) console.error("sign-in failed", e);
    const message = e instanceof SignInError ? e.message : "Sign-in is unavailable right now. Please try again.";
    return html(page({ returnTo, step: f.get("intent") === "send" ? "email" : "code", email, error: message }), 400);
  }
}
