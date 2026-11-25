// Where Coinflow sends the shopper after paying. Cardbits are credited only by the verified
// webhook; this page just waits for it and shows the result.
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer, safeReturn } from "../site/core/auth.server";
import { balanceOf } from "../site/core/ledger.server";
import { esc, htmlResponse, simplePage } from "../site/core/simple-page";

export async function loader({ request }: LoaderFunctionArgs) {
  if (process.env.CARDBIT_SITE !== "on") return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const returnTo = safeReturn(url.searchParams.get("return_to") || "/");
  const customer = await currentCustomer(db, request);
  if (!customer) return new Response(null, { status: 303, headers: { Location: `/sign-in?return_to=${encodeURIComponent(url.pathname + url.search)}` } });
  const id = url.searchParams.get("topup") || "";
  const t = id ? await db.siteTopup.findFirst({ where: { id, customerId: customer.id } }) : null;
  const back = `<a class="btn" href="${esc(returnTo)}">Continue</a>`;
  if (!t) return htmlResponse(simplePage("Payment", `<h1>Payment Not Found</h1><p class="sub">We couldn't find that payment on your account.</p>${back}`), 404);
  if (t.status === "CREDITED") {
    const bal = await balanceOf(db, customer.id);
    const total = t.baseBits + t.bonusBits;
    return htmlResponse(simplePage("Payment", `<h1>Cardbits Added</h1><p class="sub">${total.toLocaleString("en-US")} Cardbits were added. Your balance is ${bal.toLocaleString("en-US")} Cardbits.</p>${back}`));
  }
  if (t.status !== "PENDING") return htmlResponse(simplePage("Payment", `<h1>Payment Update</h1><p class="sub">This payment was reversed. Contact hello@cardbit.com with questions.</p>${back}`));
  const ageMin = (Date.now() - t.createdAt.getTime()) / 60000;
  const wait = ageMin < 15 ? `<meta http-equiv="refresh" content="3">` : "";
  const msg = ageMin < 15
    ? "We're confirming your payment. This page updates on its own."
    : "Your payment hasn't been confirmed yet. If you were charged, your Cardbits will appear as soon as it settles.";
  return htmlResponse(simplePage("Payment", `<h1>Confirming Payment</h1><p class="sub" role="status">${msg}</p>${back}`, wait));
}
