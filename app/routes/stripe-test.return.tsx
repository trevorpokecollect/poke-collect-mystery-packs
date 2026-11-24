import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { walletView } from "../lib/cardbits.server";
import { stripeClient } from "../lib/payments/stripe.server";
import { esc, html, stripeTestEnv } from "../lib/payments/stripe-test-env.server";
import { fundingId } from "../lib/payments/topup-payments.server";

// stripe-test environment only: the Checkout return page, plus buttons that drive the
// after-payment cases (duplicate webhook, full refund, lost dispute) against real test objects.
async function load(sessionId: string) {
  const t = stripeTestEnv();
  if (!t || !/^cs_test_\w+$/.test(sessionId)) return null;
  const stripe = stripeClient(t.config);
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const customer = session.metadata?.customer ?? "";
  if (session.metadata?.shop !== t.shop || !t.customers.includes(customer)) return null;
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  return { t, stripe, session, customer, pi: pi ?? null };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await load(new URL(request.url).searchParams.get("session_id") ?? "");
  if (!ctx) return new Response(null, { status: 404 });
  const { t, session, customer, pi } = ctx;
  const id = pi ? fundingId("stripe", pi) : "";
  const receipts = pi
    ? await db.cardbitReceipt.findMany({
        where: { shop: t.shop, eventKey: { in: ["fund:", "bonus:", "reverse:", "reverse-bonus:"].map((k) => k + id) } },
        orderBy: { createdAt: "asc" },
        select: { eventKey: true, kind: true, delta: true, balanceAfter: true, reason: true, createdAt: true },
      })
    : [];
  const wallet = await walletView(db, t.shop, customer);
  const disputes = pi ? (await ctx.stripe.disputes.list({ payment_intent: pi, limit: 3 })).data : [];
  const button = (action: string, label: string) =>
    `<form method="post" style="display:inline"><input type="hidden" name="do" value="${action}"><button>${label}</button></form> `;
  return html(`<h1>Checkout ${esc(session.status)}, ${esc(session.payment_status)}</h1>
<p>Session <code>${esc(session.id)}</code><br>Payment <code>${esc(pi ?? "none")}</code><br>Customer <code>${esc(customer)}</code></p>
<h2>Wallet</h2><pre>${esc(JSON.stringify(wallet, null, 2))}</pre>
<h2>Ledger entries for this payment</h2><pre>${esc(JSON.stringify(receipts, null, 2))}</pre>
<h2>Disputes</h2><pre>${esc(JSON.stringify(disputes.map((d) => ({ id: d.id, status: d.status, reason: d.reason })), null, 2))}</pre>
<p>${button("replay", "Resend the completed webhook")}${button("refund", "Refund in full")}${disputes.length ? button("lose", "Lose the dispute") : ""}
<a href="">Refresh</a> · <a href="/stripe-test">New checkout</a></p>`);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  const ctx = await load(url.searchParams.get("session_id") ?? "");
  if (!ctx || !ctx.pi) return new Response(null, { status: 404 });
  const { t, stripe, session, pi } = ctx;
  const what = String((await request.formData()).get("do"));
  if (what === "replay") {
    const events = await stripe.events.list({ type: "checkout.session.completed", limit: 50 });
    const event = events.data.find((e) => (e.data.object as { id?: string }).id === session.id);
    if (event) {
      // Redeliver through the real endpoint so signature checking and idempotency are both exercised.
      const payload = JSON.stringify(event);
      const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: t.config.webhookSecret });
      const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/webhooks/stripe`, {
        method: "POST",
        headers: { "content-type": "application/json", "stripe-signature": signature },
        body: payload,
      });
      console.log(`stripe-test replay ${event.id}: HTTP ${res.status} ${await res.text()}`);
    }
  } else if (what === "refund") {
    await stripe.refunds.create({ payment_intent: pi }, { idempotencyKey: `stripe-test-refund:${pi}` });
  } else if (what === "lose") {
    for (const d of (await stripe.disputes.list({ payment_intent: pi, limit: 3 })).data)
      if (d.status === "needs_response" || d.status === "warning_needs_response")
        await stripe.disputes.update(d.id, { evidence: { uncategorized_text: "losing_evidence" }, submit: true });
  }
  return new Response(null, { status: 303, headers: { location: url.pathname + url.search } });
};
