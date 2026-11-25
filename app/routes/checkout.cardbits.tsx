// Standalone site: buy Cardbits with a card through Coinflow. 404 unless CARDBIT_SITE=on.
// GET shows the package + billing state/ZIP; POST checks the state block (billing + IP),
// records a PENDING SiteTopup and sends the shopper to Coinflow's hosted checkout.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { clientIp, currentCustomer, safeReturn, siteOrigin } from "../site/core/auth.server";
import { esc, htmlResponse, simplePage } from "../site/core/simple-page";
import { EXCLUDED_STATES, RegionBlocked, US_STATES, assertAllowedRegion, defaultGeoLookup } from "../site/region.server";
import { CoinflowError, coinflowConfigured, createCheckoutLink, topupPackage } from "../site/payments/coinflow.server";
import { createStripeCheckout, siteStripe, siteStripeConfig, topupProvider } from "../site/payments/stripe-site.server";

const on = () => process.env.CARDBIT_SITE === "on";
const fmt = (n: number) => n.toLocaleString("en-US");
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const allowedStates = [...US_STATES].filter((s) => !(EXCLUDED_STATES as readonly string[]).includes(s)).sort();

function form(o: { amount: number; returnTo: string; state?: string; zip?: string; error?: string }) {
  const p = topupPackage(o.amount)!;
  const opts = allowedStates.map((s) => `<option${s === o.state ? " selected" : ""}>${s}</option>`).join("");
  const err = o.error ? `<p class="err" role="alert">${esc(o.error)}</p>` : "";
  const bonus = p.bonusBits ? `<div class="sum"><span>Bonus</span><b>+${fmt(p.bonusBits)} Cardbits</b></div>` : "";
  return simplePage(
    "Buy Cardbits",
    `<h1>Buy Cardbits</h1><p class="sub">Paid securely by card.</p>${err}
     <div class="sum"><span>Cardbits</span><b>${fmt(p.baseBits)}</b></div>${bonus}
     <div class="sum"><span>Total</span><b>${usd(p.cents)}</b></div>
     <form method="post" id="f"><input type="hidden" name="amount" value="${p.baseBits}">
     <input type="hidden" name="return_to" value="${esc(o.returnTo)}"><input type="hidden" name="device_id" id="dev">
     <label for="state">Billing State</label><select id="state" name="state" required><option value="">Choose…</option>${opts}</select>
     <label for="zip">Billing ZIP Code</label><input id="zip" name="zip" inputmode="numeric" autocomplete="postal-code" pattern="[0-9]{5}" maxlength="5" required value="${esc(o.zip || "")}">
     <button class="btn" type="submit">Continue To Payment</button></form>
     <p class="fine">Cardbits purchases are final sale. Not available in AL, HI, ID, MN, NV, NY, UT or WA. <a href="${esc(o.returnTo)}">Cancel</a></p>
     <script>document.getElementById("f").addEventListener("submit",function(){try{var d=window.nSureSDK&&window.nSureSDK.getDeviceId();if(d)document.getElementById("dev").value=d}catch(e){}});</script>`,
  );
}

function blocked(msg: string, returnTo: string, status = 400) {
  return htmlResponse(simplePage("Buy Cardbits", `<h1>Buy Cardbits</h1><p class="err" role="alert">${esc(msg)}</p><p><a href="${esc(returnTo)}">Back</a></p>`), status);
}

async function guard(request: Request, amountRaw: string | null, returnTo: string) {
  const customer = await currentCustomer(db, request);
  if (!customer) {
    const here = `/checkout/cardbits?amount=${encodeURIComponent(amountRaw || "")}&return_to=${encodeURIComponent(returnTo)}`;
    return { res: new Response(null, { status: 303, headers: { Location: `/sign-in?return_to=${encodeURIComponent(here)}` } }) };
  }
  const amount = Number(amountRaw);
  if (!topupPackage(amount)) return { res: blocked("Choose a Cardbits package.", returnTo) };
  if (customer.frozenAt || customer.closedAt) return { res: blocked("This account can't buy Cardbits right now. Contact hello@cardbit.com.", returnTo, 403) };
  if (topupProvider() === "coinflow" && !coinflowConfigured()) return { res: blocked("Card checkout isn't open yet.", returnTo, 503) };
  return { customer, amount };
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (!on()) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const returnTo = safeReturn(url.searchParams.get("return_to") || "/");
  const g = await guard(request, url.searchParams.get("amount"), returnTo);
  if (g.res) return g.res;
  return htmlResponse(form({ amount: g.amount, returnTo }));
}

export async function action({ request }: ActionFunctionArgs) {
  if (!on()) return new Response("Not found", { status: 404 });
  const fd = await request.formData();
  const returnTo = safeReturn(String(fd.get("return_to") || "/"));
  const g = await guard(request, String(fd.get("amount") || ""), returnTo);
  if (g.res) return g.res;
  const state = String(fd.get("state") || "").trim().toUpperCase();
  const zip = String(fd.get("zip") || "").trim();
  const again = (error: string, status = 400) => htmlResponse(form({ amount: g.amount, returnTo, state, zip, error }), status);
  if (!/^\d{5}$/.test(zip)) return again("Enter a 5-digit ZIP code.");
  const ip = clientIp(request);
  let region;
  try {
    region = await assertAllowedRegion({ action: "topup", billing: { country: "US", state }, ip }, defaultGeoLookup());
  } catch (e) {
    if (e instanceof RegionBlocked) return again(e.message, 403);
    throw e;
  }
  if (!ip) return again("We couldn't confirm your connection. Please try again.");
  const p = topupPackage(g.amount)!;
  const provider = topupProvider();
  const topup = await db.siteTopup.create({
    data: { customerId: g.customer.id, ...p, provider, billingState: state, billingZip: zip, ip, ipRegion: region.ipRegion },
  });
  const callbackUrl = `${siteOrigin()}/checkout/cardbits/return?topup=${encodeURIComponent(topup.id)}&return_to=${encodeURIComponent(returnTo)}`;
  if (provider === "stripe") {
    try {
      const url = await createStripeCheckout(siteStripe(siteStripeConfig()!), topup, g.customer.email, {
        success: callbackUrl,
        cancel: `${siteOrigin()}/checkout/cardbits?amount=${p.baseBits}&return_to=${encodeURIComponent(returnTo)}`,
      });
      return new Response(null, { status: 303, headers: { Location: url } });
    } catch (e) {
      console.error("[site] stripe checkout failed", (e as Error).message);
      return again("Card checkout is unavailable right now. Please try again.", 502);
    }
  }
  try {
    const link = await createCheckoutLink({ topup, email: g.customer.email, ip, deviceId: String(fd.get("device_id") || "") || null, callbackUrl });
    return new Response(null, { status: 303, headers: { Location: link } });
  } catch (e) {
    if (e instanceof CoinflowError) return again(e.message, 502);
    throw e;
  }
}
