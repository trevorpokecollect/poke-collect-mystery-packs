import type { ActionFunctionArgs } from "react-router";
import { topups } from "../lib/cardbit-topups.server";
import { createTopupCheckout, stripeClient } from "../lib/payments/stripe.server";
import { esc, html, stripeTestEnv } from "../lib/payments/stripe-test-env.server";

// stripe-test environment only: starts embedded Checkout for a QA customer, standing in for
// the storefront page until the theme work lands.
export const loader = async () => {
  const t = stripeTestEnv();
  if (!t) return new Response(null, { status: 404 });
  const customers = t.customers.map((c) => `<option>${esc(c)}</option>`).join("");
  const packages = topups
    .filter((p) => t.config.prices[p.variant])
    .map((p) => `<option value="${esc(p.variant)}">$${p.amount / 100} → ${p.amount + p.bonus} Cardbits</option>`)
    .join("");
  return html(`<h1>Buy Cardbits (test)</h1>
<label>Customer <select id="customer">${customers}</select></label><br>
<label>Package <select id="variant">${packages}</select></label><br>
<button id="start">Start checkout</button>
<div id="checkout" style="margin-top:16px"></div>
<script src="https://js.stripe.com/v3/"></script>
<script>
document.getElementById("start").onclick = async () => {
  document.getElementById("start").disabled = true;
  const res = await fetch(location.pathname, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ customer: document.getElementById("customer").value, variant: document.getElementById("variant").value }) });
  if (!res.ok) { document.getElementById("checkout").textContent = "Could not start checkout (" + res.status + ")"; return; }
  const { clientSecret, publishableKey } = await res.json();
  const stripe = Stripe(publishableKey);
  const make = stripe.createEmbeddedCheckoutPage ? stripe.createEmbeddedCheckoutPage.bind(stripe) : stripe.initEmbeddedCheckout.bind(stripe);
  const checkout = await make({ fetchClientSecret: async () => clientSecret });
  checkout.mount("#checkout");
};
</script>`);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const t = stripeTestEnv();
  if (!t || request.method !== "POST") return new Response(null, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { customer?: string; variant?: string };
  if (!body.customer || !t.customers.includes(body.customer)) return new Response(null, { status: 403 });
  const started = await createTopupCheckout(stripeClient(t.config), t.config, t.shop, body.customer, String(body.variant ?? ""));
  return started ? Response.json(started) : new Response(null, { status: 400 });
};
