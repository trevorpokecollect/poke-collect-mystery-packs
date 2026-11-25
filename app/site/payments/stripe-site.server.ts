// Stripe as the standalone site's BACKUP top-up processor (Coinflow is primary).
// Test mode only unless SITE_STRIPE_LIVE_APPROVED=yes, which needs Trevor's go after Stripe's
// written business-model approval. Uses hosted Checkout; Cardbits are credited only from a
// signed webhook after the session is re-read from Stripe. Crediting/refund/chargeback rules are
// shared with Coinflow (handleCoinflowEvent) so both processors behave the same.
import Stripe from "stripe";
import type { PrismaClient, SiteTopup } from "@prisma/client";
import { handleCoinflowEvent, type WebhookDeps } from "./coinflow.server";

type Env = NodeJS.ProcessEnv;

export type SiteStripeConfig = { secretKey: string; webhookSecret: string; live: boolean };

export function siteStripeConfig(env: Env = process.env): SiteStripeConfig | null {
  const secretKey = env.SITE_STRIPE_SECRET_KEY ?? "";
  const webhookSecret = env.SITE_STRIPE_WEBHOOK_SECRET ?? "";
  const live = /^(sk|rk)_live_/.test(secretKey);
  const test = /^(sk|rk)_test_/.test(secretKey);
  if ((!live && !test) || !webhookSecret.startsWith("whsec_")) return null;
  if (live && env.SITE_STRIPE_LIVE_APPROVED !== "yes") return null;
  return { secretKey, webhookSecret, live };
}

/** Which processor sells top-ups: SITE_PAYMENT_PROVIDER=stripe switches to Stripe when configured. */
export function topupProvider(env: Env = process.env): "coinflow" | "stripe" {
  return env.SITE_PAYMENT_PROVIDER === "stripe" && siteStripeConfig(env) ? "stripe" : "coinflow";
}

let client: { key: string; stripe: Stripe } | null = null;
export function siteStripe(config: SiteStripeConfig) {
  if (!client || client.key !== config.secretKey) client = { key: config.secretKey, stripe: new Stripe(config.secretKey, { maxNetworkRetries: 2 }) };
  return client.stripe;
}

export async function createStripeCheckout(
  stripe: Pick<Stripe, "checkout">,
  t: SiteTopup,
  email: string,
  urls: { success: string; cancel: string },
  threeDS: "any" | "automatic" = "automatic",
) {
  const total = t.baseBits + t.bonusBits;
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: t.cents,
            product_data: { name: `${total.toLocaleString("en-US")} Cardbits`, description: "Cardbits are final sale." },
          },
        },
      ],
      success_url: urls.success,
      cancel_url: urls.cancel,
      client_reference_id: t.id,
      metadata: { topupId: t.id, customerId: t.customerId, site: "cardbit-site" },
      payment_intent_data: { metadata: { topupId: t.id, customerId: t.customerId, site: "cardbit-site" } },
      billing_address_collection: "required",
      payment_method_options: { card: { request_three_d_secure: threeDS } },
    },
    { idempotencyKey: `site-topup:${t.id}` },
  );
  if (!session.url) throw new Error("Stripe returned no Checkout URL.");
  return session.url;
}

/** Stripe Radar's verdict on the payment (risk_level normal/elevated/highest, risk_score with Radar for Fraud Teams). */
async function radarRisk(stripe: Partial<Pick<Stripe, "paymentIntents">>, paymentIntent: string) {
  if (!stripe.paymentIntents) return null;
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntent, { expand: ["latest_charge"] });
    const charge = intent.latest_charge;
    const outcome = charge && typeof charge !== "string" ? charge.outcome : null;
    return outcome ? { level: outcome.risk_level ?? null, score: outcome.risk_score ?? null } : null;
  } catch (e) {
    console.warn("[site] radar lookup failed", (e as Error).message);
    return null;
  }
}

const pi = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : v?.id) || null;

/** Handles one signature-verified Stripe event for site top-ups. Safe to replay. */
export async function handleSiteStripeEvent(
  deps: WebhookDeps,
  stripe: Pick<Stripe, "checkout"> & Partial<Pick<Stripe, "paymentIntents">>,
  config: SiteStripeConfig,
  event: Stripe.Event,
): Promise<string> {
  if (event.livemode !== config.live) return "ignored:mode";
  const db: PrismaClient = deps.db;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = await stripe.checkout.sessions.retrieve(event.data.object.id);
      const topupId = s.metadata?.topupId;
      const paymentIntent = pi(s.payment_intent);
      if (s.metadata?.site !== "cardbit-site" || !topupId) return "ignored:not_site";
      if (s.status !== "complete" || s.payment_status !== "paid" || s.mode !== "payment" || s.currency !== "usd" || !paymentIntent)
        return "not_paid";
      const t = await db.siteTopup.findUnique({ where: { id: topupId } });
      if (!t || t.provider !== "stripe") return "ignored:unknown_topup";
      return handleCoinflowEvent(deps, {
        eventType: "Settled",
        data: {
          id: `stripe:${paymentIntent}`,
          subtotal: { cents: s.amount_total ?? -1, currency: "USD" },
          webhookInfo: { topupId, customerId: s.metadata?.customerId },
          risk: await radarRisk(stripe, paymentIntent),
        },
      });
    }
    case "charge.refunded": {
      const ch = event.data.object;
      const paymentIntent = pi(ch.payment_intent);
      if (!paymentIntent) return "ignored:no_payment";
      // amount_refunded is cumulative: this event's refund = new total - previous total.
      const prev = (event.data.previous_attributes as { amount_refunded?: number } | undefined)?.amount_refunded ?? 0;
      const cents = ch.amount_refunded - prev;
      if (cents <= 0) return "ignored:no_new_refund";
      return handleCoinflowEvent(deps, {
        eventType: "Refund",
        data: { paymentId: `stripe:${paymentIntent}`, refundId: `stripe:${paymentIntent}:${ch.amount_refunded}`, totals: { subtotal: { cents } } },
      });
    }
    case "charge.dispute.created": {
      const paymentIntent = pi(event.data.object.payment_intent);
      if (!paymentIntent) return "ignored:no_payment";
      return handleCoinflowEvent(deps, { eventType: "Card Payment Chargeback Opened", data: { id: `stripe:${paymentIntent}` } });
    }
    case "charge.dispute.closed": {
      const d = event.data.object;
      const paymentIntent = pi(d.payment_intent);
      if (!paymentIntent) return "ignored:no_payment";
      if (d.status !== "won" && d.status !== "lost") return "ignored:dispute_status";
      return handleCoinflowEvent(deps, {
        eventType: d.status === "won" ? "Card Payment Chargeback Won" : "Card Payment Chargeback Lost",
        data: { id: `stripe:${paymentIntent}` },
      });
    }
    default:
      return "logged";
  }
}
