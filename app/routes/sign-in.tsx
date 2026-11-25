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
import { recordSignupAge } from "../site/core/age.server";
import { mailerFromEnv } from "../site/email/mailer.server";
import { esc, simplePage } from "../site/core/simple-page";

const on = () => process.env.CARDBIT_SITE === "on";

const GOOGLE_G = `<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

// Full-page fallback (no JavaScript, or a direct link). The storefront normally shows the
// same steps in a small window over the page (public/site/js/cardbit-site-auth.js).
function page(o: { returnTo: string; step: "email" | "code"; email?: string; error?: string; note?: string }) {
  const rt = esc(o.returnTo);
  const err = o.error ? `<p class="err" role="alert">${esc(o.error)}</p>` : "";
  const note = o.note ? `<p class="note" role="status">${esc(o.note)}</p>` : "";
  const body =
    o.step === "email"
      ? `<a class="btn g" href="/auth/google?return_to=${encodeURIComponent(o.returnTo)}">${GOOGLE_G}<span>Continue With Google</span></a>
         <div class="or"><span>or</span></div>
         <form method="post"><input type="hidden" name="intent" value="send"><input type="hidden" name="return_to" value="${rt}">
         <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required value="${esc(o.email || "")}">
         <button class="btn" type="submit">Email Me a Sign-In Code</button></form>
         <p class="fine">By Continuing You Agree to the <a href="/policies">Terms and Privacy Policy</a>.</p>`
      : `<form method="post"><input type="hidden" name="intent" value="verify"><input type="hidden" name="return_to" value="${rt}">
         <input type="hidden" name="email" value="${esc(o.email || "")}">
         <label for="code">6-Digit Code Sent to ${esc(o.email || "")}</label>
         <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required autofocus>
         <button class="btn" type="submit">Sign In</button></form>
         <form method="post"><input type="hidden" name="intent" value="send"><input type="hidden" name="return_to" value="${rt}">
         <input type="hidden" name="email" value="${esc(o.email || "")}"><button class="link" type="submit">Send a New Code</button></form>`;
  return simplePage("Sign In", `<h1>Sign In to Cardbit</h1><p class="sub">New Here? Signing In Creates Your Account.</p>${err}${note}${body}`);
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

// The storefront's sign-in dialog posts here with Accept: application/json and gets JSON back
// (same rules, same cookie). Without it, this route serves the full-page fallback.
const wantsJson = (request: Request) => (request.headers.get("accept") || "").includes("application/json");
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

export async function action({ request }: ActionFunctionArgs) {
  if (!on()) return new Response("Not found", { status: 404 });
  const asJson = wantsJson(request);
  const f = await request.formData();
  const returnTo = safeReturn(String(f.get("return_to") || ""));
  const email = String(f.get("email") || "").slice(0, 254);
  try {
    if (f.get("intent") === "send") {
      const issued = await issueEmailCode(db, email, clientIp(request));
      await sendEmail(
        { db, mailer: mailerFromEnv() },
        "signin_code",
        issued.email,
        { code: issued.code, minutes: 10, email: issued.email, returnTo },
        issued.id,
      );
      if (asJson) return json({ ok: true, step: "code", email: issued.email });
      return html(page({ returnTo, step: "code", email: issued.email, note: "We emailed you a 6-digit code." }));
    }
    const customer = await verifyEmailCode(db, email, String(f.get("code") || ""));
    await recordSignupAge(db, customer.id, f.get("age") === "1");
    const cookie = await createSession(db, customer.id, request);
    if (asJson) return json({ ok: true, signedIn: true, returnTo }, 200, { "Set-Cookie": cookie });
    return new Response(null, { status: 303, headers: { Location: returnTo, "Set-Cookie": cookie } });
  } catch (e) {
    if (!(e instanceof SignInError)) console.error("sign-in failed", e);
    const message = e instanceof SignInError ? e.message : "Sign-in is unavailable right now. Please try again.";
    if (asJson) return json({ error: message }, e instanceof SignInError ? 400 : 500);
    return html(page({ returnTo, step: f.get("intent") === "send" ? "email" : "code", email, error: message }), 400);
  }
}
