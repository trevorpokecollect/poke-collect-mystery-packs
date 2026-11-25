// /sign-in/link: the "Sign In To Cardbit" button in the sign-in code email.
// The code arrives in the URL #fragment (never sent to the server). The page fills it in and asks
// for one tap, then posts the normal code check to /sign-in. Mail scanners that open links can't
// use the code up, and without JavaScript the shopper can still type the code.
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer, normalizeEmail, safeReturn, validEmail } from "../site/core/auth.server";
import { esc, htmlResponse, simplePage } from "../site/core/simple-page";

export async function loader({ request }: LoaderFunctionArgs) {
  if (process.env.CARDBIT_SITE !== "on") return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const returnTo = safeReturn(url.searchParams.get("rt"));
  if (await currentCustomer(db, request)) return Response.redirect(new URL(returnTo, url).toString(), 303);
  const email = normalizeEmail(url.searchParams.get("e") || "");
  if (!validEmail(email)) return Response.redirect(new URL(`/sign-in?return_to=${encodeURIComponent(returnTo)}`, url).toString(), 303);
  return htmlResponse(
    simplePage(
      "Sign In",
      `<h1>Sign In to Cardbit</h1><p class="sub">Signing In as <b>${esc(email)}</b></p>
       <form method="post" action="/sign-in" id="f"><input type="hidden" name="intent" value="verify">
       <input type="hidden" name="email" value="${esc(email)}"><input type="hidden" name="return_to" value="${esc(returnTo)}">
       <label for="code">Sign-In Code</label>
       <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required>
       <button class="btn" type="submit">Sign In</button></form>
       <p class="fine">Not You? <a href="/sign-in?return_to=${encodeURIComponent(returnTo)}">Use a Different Email</a></p>
       <script>(function(){var m=location.hash.match(/c=(\\d{6})/);if(!m)return;var i=document.getElementById("code");i.value=m[1];history.replaceState(null,"",location.pathname+location.search);document.querySelector("#f .btn").focus();})();</script>`,
    ),
  );
}
