// Stripe adapter for Cardbits top-ups: embedded Checkout on cardbit.com, credited only from a
// signed Stripe webhook after the session is re-read from Stripe's API.
// Off unless CARDBIT_PAYMENT_PROVIDER=stripe and every key is set. Live keys are refused unless
// CARDBIT_STRIPE_LIVE_APPROVED=yes, which only Trevor may authorize.
import Stripe from "stripe";
import type { PrismaClient } from "@prisma/client";
import { flagPaymentRisk, recordSignal } from "../cardbit-guard.server";
import { isCardbit } from "../cardbit.server";
import { topups } from "../cardbit-topups.server";
import {
  creditTopupPayment,
  holdTopupPayment,
  reverseTopupPayment,
  topupPackage,
  type VerifiedTopupPayment,
} from "./topup-payments.server";

export type StripeConfig = {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
  live: boolean;
  /** Package variant (digits) → Stripe Price id. */
  prices: Record<string, string>;
  returnUrl: string;
};

// The storefront's My Cardbits page; the theme shows progress until the webhook credits the payment.
const DEFAULT_RETURN = "https://cardbit.com/?cb=cardbits&topup={CHECKOUT_SESSION_ID}";

export function stripeConfig(shop: string, env = process.env): StripeConfig | null {
  if (!isCardbit(shop, env) || env.CARDBIT_PAYMENT_PROVIDER !== "stripe") return null;
  const secretKey = env.STRIPE_SECRET_KEY ?? "",
    publishableKey = env.STRIPE_PUBLISHABLE_KEY ?? "",
    webhookSecret = env.STRIPE_WEBHOOK_SECRET ?? "";
  const live = secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_");
  const test = secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_");
  if (
    (!live && !test) ||
    !publishableKey.startsWith(live ? "pk_live_" : "pk_test_") ||
    !webhookSecret.startsWith("whsec_") ||
    (live && env.CARDBIT_STRIPE_LIVE_APPROVED !== "yes")
  )
    return null;
  let prices: Record<string, string>;
  try {
    prices = JSON.parse(env.STRIPE_TOPUP_PRICES || "{}");
  } catch {
    return null;
  }
  if (
    !prices ||
    typeof prices !== "object" ||
    Array.isArray(prices) ||
    !Object.entries(prices).every(
      ([variant, price]) => topupPackage(variant) && typeof price === "string" && /^price_\w+$/.test(price),
    ) ||
    !Object.keys(prices).length
  )
    return null;
  const returnUrl = env.STRIPE_TOPUP_RETURN_URL || DEFAULT_RETURN;
  if (!/^https:\/\//.test(returnUrl) || !returnUrl.includes("{CHECKOUT_SESSION_ID}")) return null;
  return { secretKey, publishableKey, webhookSecret, live, prices, returnUrl };
}

/**
 * Tells the storefront wallet to sell top-ups through Stripe Checkout when Stripe is on: only
 * packages with a configured Stripe price are offered. A wallet that is off is returned as is.
 */
export function withStripeTopups<T extends { enabled: boolean }>(view: T, shop: string, env = process.env) {
  const config = view.enabled ? stripeConfig(shop, env) : null;
  if (!config) return view;
  return {
    ...view,
    payment: "stripe" as const,
    checkoutReady: true,
    topups: topups
      .filter((t) => config.prices[t.variant])
      .map(({ variant, amount, bonus }) => ({ variant, amount, bonus })),
  };
}

const clients = new Map<string, Stripe>();
export function stripeClient(config: StripeConfig): Stripe {
  let client = clients.get(config.secretKey);
  if (!client) {
    client = new Stripe(config.secretKey, { maxNetworkRetries: 2 });
    clients.set(config.secretKey, client);
  }
  return client;
}

/** Starts an embedded Checkout for one top-up package. Returns what Stripe.js needs. */
export async function createTopupCheckout(
  stripe: Pick<Stripe, "checkout">,
  config: StripeConfig,
  shop: string,
  customerId: string,
  variant: string,
  /** From the fraud guard: "any" forces 3D Secure (new accounts, first or large top-ups). */
  threeDSecure: "any" | "automatic" = "automatic",
) {
  const tier = topupPackage(variant);
  const price = config.prices[variant];
  if (!tier || !price) return null;
  const session = await stripe.checkout.sessions.create(
    {
      ui_mode: "embedded_page",
      mode: "payment",
      line_items: [{ price, quantity: 1 }],
      return_url: config.returnUrl,
      client_reference_id: customerId.split("/").pop(),
      metadata: { shop, customer: customerId, variant, cardbits: String(tier.amount), bonus: String(tier.bonus) },
      payment_intent_data: { metadata: { shop, customer: customerId, variant } },
      payment_method_options: { card: { request_three_d_secure: threeDSecure } },
    },
    // One open Checkout per customer, package and minute: a double click reuses it.
    { idempotencyKey: `topup:${customerId}:${variant}:${threeDSecure}:${Math.floor(Date.now() / 60_000)}` },
  );
  if (!session.client_secret) return null;
  return { clientSecret: session.client_secret, publishableKey: config.publishableKey };
}

type SessionForCredit = Pick<
  Stripe.Checkout.Session,
  "id" | "status" | "payment_status" | "mode" | "currency" | "amount_total" | "livemode" | "metadata" | "payment_intent"
> & { line_items?: { data: { quantity: number | null; price: { id: string } | null }[]; has_more: boolean } | null };

/**
 * Checks a Checkout Session read back from Stripe against everything we sold.
 * Returns the verified payment, or null when anything differs.
 */
export function verifyTopupSession(
  session: SessionForCredit,
  config: StripeConfig,
  shop: string,
): VerifiedTopupPayment | null {
  const meta = session.metadata ?? {};
  const variant = meta.variant ?? "";
  const tier = topupPackage(variant);
  const lines = session.line_items;
  const paymentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (
    !tier ||
    session.status !== "complete" ||
    session.payment_status !== "paid" ||
    session.mode !== "payment" ||
    session.currency !== "usd" ||
    session.livemode !== config.live ||
    session.amount_total !== tier.amount ||
    meta.shop !== shop ||
    !/^gid:\/\/shopify\/Customer\/\d+$/.test(meta.customer ?? "") ||
    !paymentId ||
    !lines ||
    lines.has_more ||
    lines.data.length !== 1 ||
    lines.data[0].quantity !== 1 ||
    lines.data[0].price?.id !== config.prices[variant]
  )
    return null;
  return { provider: "stripe", paymentId, customerId: meta.customer!, variant, paidCents: session.amount_total };
}

export type StripeEventResult =
  | "credited"
  | "already-credited"
  | "not-verified"
  | "held"
  | "reversed"
  | "ignored";

/** Handles one signature-verified Stripe event. Safe to replay. */
export async function handleStripeEvent(
  db: PrismaClient,
  stripe: Pick<Stripe, "checkout" | "charges"> & Partial<Pick<Stripe, "paymentIntents">>,
  config: StripeConfig,
  shop: string,
  event: Stripe.Event,
): Promise<StripeEventResult> {
  if (event.livemode !== config.live) return "ignored";
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      // Never trust the event body: read the session back with its line items.
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
        expand: ["line_items"],
      });
      const payment = verifyTopupSession(session, config, shop);
      if (!payment) {
        if (session.payment_status === "paid")
          console.error(`Stripe Checkout ${session.id} was paid but did not match a Cardbits package`);
        return "not-verified";
      }
      const before = await db.cardbitReceipt.findUnique({
        where: { shop_eventKey: { shop, eventKey: "fund:stripe:" + payment.paymentId } },
        select: { id: true },
      });
      const receipt = await creditTopupPayment(db, shop, payment);
      if (!receipt) return "not-verified";
      if (!before) await recordCardSignal(db, stripe, shop, payment.customerId, payment.paymentId);
      return before ? "already-credited" : "credited";
    }
    case "charge.refunded": {
      const charge = event.data.object;
      const paymentId = intentId(charge.payment_intent);
      if (!paymentId || !(await ours(db, shop, paymentId))) return "ignored";
      // Top-ups are final sale; a refund staff issue anyway takes every Cardbit back when it is
      // full, and freezes the wallet for review when it is partial.
      if (charge.refunded && charge.amount_refunded === charge.amount) {
        await reverseTopupPayment(db, shop, "stripe", paymentId, "Refunded in Stripe");
        return "reversed";
      }
      await holdTopupPayment(db, shop, "stripe", paymentId);
      return "held";
    }
    case "charge.dispute.created":
    case "charge.dispute.funds_withdrawn": {
      const paymentId = await disputedIntent(stripe, event.data.object);
      const customerId = paymentId ? await ours(db, shop, paymentId) : null;
      if (!paymentId || !customerId) return "ignored";
      await holdTopupPayment(db, shop, "stripe", paymentId);
      if (event.type === "charge.dispute.created")
        await flagPaymentRisk(db, shop, customerId, "stripe-dispute", paymentId);
      return "held";
    }
    case "radar.early_fraud_warning.created": {
      // The card issuer reported likely fraud: freeze the wallet and send the account to review.
      const paymentId = await disputedIntent(stripe, event.data.object);
      const customerId = paymentId ? await ours(db, shop, paymentId) : null;
      if (!paymentId || !customerId) return "ignored";
      await holdTopupPayment(db, shop, "stripe", paymentId);
      await flagPaymentRisk(db, shop, customerId, "stripe-efw", paymentId);
      return "held";
    }
    case "charge.dispute.closed": {
      const dispute = event.data.object;
      const paymentId = await disputedIntent(stripe, dispute);
      if (!paymentId || !(await ours(db, shop, paymentId))) return "ignored";
      if (dispute.status === "lost") {
        await reverseTopupPayment(db, shop, "stripe", paymentId, "Dispute lost in Stripe");
        return "reversed";
      }
      // Won or withdrawn: the wallet stays held until staff release it.
      return "held";
    }
    default:
      return "ignored";
  }
}

const intentId = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null);

async function disputedIntent(
  stripe: Pick<Stripe, "charges">,
  dispute: Pick<Stripe.Dispute, "payment_intent" | "charge"> | Pick<Stripe.Radar.EarlyFraudWarning, "payment_intent" | "charge">,
) {
  const direct = intentId(dispute.payment_intent);
  if (direct) return direct;
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
  if (!chargeId) return null;
  return intentId((await stripe.charges.retrieve(chargeId)).payment_intent);
}

/**
 * Only payments this app credited are acted on; other Stripe activity is left alone.
 * Returns the credited customer, or null.
 */
async function ours(db: PrismaClient, shop: string, paymentId: string) {
  const receipt = await db.cardbitReceipt.findUnique({
    where: { shop_eventKey: { shop, eventKey: "fund:stripe:" + paymentId } },
    select: { customerId: true },
  });
  return receipt?.customerId ?? null;
}

/**
 * Records the card's fingerprint for the fraud guard (3+ accounts on one card go to review).
 * Best effort: a lookup failure never blocks a credit that has already been written.
 */
async function recordCardSignal(
  db: PrismaClient,
  stripe: Partial<Pick<Stripe, "paymentIntents">>,
  shop: string,
  customerId: string,
  paymentId: string,
) {
  if (!stripe.paymentIntents) return;
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentId, { expand: ["latest_charge"] });
    const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
    const fingerprint = charge?.payment_method_details?.card?.fingerprint;
    if (fingerprint) await recordSignal(db, shop, customerId, "card", fingerprint);
  } catch (error) {
    console.error(`Stripe card signal for ${paymentId} was not recorded`, error instanceof Error ? error.message : error);
  }
}
