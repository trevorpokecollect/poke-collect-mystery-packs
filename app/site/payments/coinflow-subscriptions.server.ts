// Coinflow side of Cardbit Club subscriptions. Coinflow has native card subscriptions
// (docs.coinflow.cash/guides/subscriptions): plans are set up by Coinflow, the first payment runs at
// sign-up, renewals arrive as "Settled" purchase webhooks carrying a subscription object, and
// lifecycle events are "Subscription Created | Canceled | Expired | Failure".
//
// UNCONFIRMED until Coinflow sets up our plans (ask your Coinflow rep):
// - Whether the hosted checkout link accepts `planCode` (used below) or we must embed their card
//   form + POST /subscription/{merchantId}/subscribers/card.
// - The merchant-side cancel endpoint (docs show PATCH /subscription/{merchantId}/subscribers/{id}).
// - Exact webhook field names; parsing below is defensive and every event is logged raw.
import type { PrismaClient, SiteSubscription } from "@prisma/client";
import { CoinflowError, type CoinflowEvent } from "./coinflow.server";
import {
  TIERS,
  creditSubscriptionPayment,
  markSubscription,
  reverseSubscriptionPayment,
  startSubscription,
  tierById,
  type Tier,
  type TierId,
} from "../play/subscriptions.server";
import { PLAN } from "../play/plan-brand";

type Env = NodeJS.ProcessEnv;
const apiRoot = (env: Env) => (env.COINFLOW_API_BASE || (env.COINFLOW_ENV === "production" ? "https://api.coinflow.cash/api" : "https://api-sandbox.coinflow.cash/api")).replace(/\/$/, "");

/** Plan code Coinflow gives us for a tier: SITE_COINFLOW_PLAN_PLUS / _PRO / _ULTIMATE. */
export const planCode = (tier: TierId, env: Env = process.env) => env[`SITE_COINFLOW_PLAN_${tier.toUpperCase()}`] || null;
export const tierForPlan = (code: unknown, env: Env = process.env): Tier | null =>
  typeof code === "string" ? (TIERS.find((t) => planCode(t.id, env) === code) ?? null) : null;
export const subscriptionsReady = (env: Env = process.env) =>
  env.SITE_SUBSCRIPTIONS === "on" && Boolean(env.COINFLOW_API_KEY && env.COINFLOW_MERCHANT_ID) && TIERS.every((t) => planCode(t.id, env));

/** Hosted Coinflow checkout for the first month of a plan. */
export async function createSubscriptionLink(
  i: { customerId: string; email: string; tier: TierId; ip: string; callbackUrl: string },
  env: Env = process.env,
  fetcher: typeof fetch = fetch,
) {
  const tier = tierById(i.tier);
  const code = tier && planCode(tier.id, env);
  if (!tier || !code || !subscriptionsReady(env)) throw new CoinflowError(`${PLAN.name} isn't open yet.`);
  const res = await fetcher(`${apiRoot(env)}/checkout/link`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", Authorization: env.COINFLOW_API_KEY!, "x-coinflow-auth-user-id": i.customerId },
    body: JSON.stringify({
      subtotal: { cents: tier.cents, currency: "USD" },
      presentment: "USD",
      email: i.email,
      planCode: code,
      webhookInfo: { kind: "cardbit_club", tier: tier.id, customerId: i.customerId },
      standaloneLinkConfig: { callbackUrl: i.callbackUrl, endUserDeviceIpAddress: i.ip },
      chargebackProtectionData: [
        { productName: `${PLAN.name} ${tier.name}`, productType: env.COINFLOW_PRODUCT_TYPE || "topUp", quantity: 1, rawProductData: { sku: `club-${tier.id}`, monthlyBits: tier.monthlyBits, bonusBits: tier.bonusBits } },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error("[site] coinflow subscription link failed", res.status, text.slice(0, 500));
    throw new CoinflowError("Checkout is unavailable right now. Please try again.", res.status);
  }
  const link = (() => {
    try {
      return (JSON.parse(text) as { link?: unknown }).link;
    } catch {
      return null;
    }
  })();
  if (typeof link !== "string" || !/^https:\/\//.test(link)) throw new CoinflowError("Coinflow returned no checkout link.");
  return link;
}

/** Stop renewals at Coinflow. Throws if Coinflow refuses, so callers can tell staff to cancel by hand. */
export async function cancelAtCoinflow(s: SiteSubscription, env: Env = process.env, fetcher: typeof fetch = fetch) {
  if (s.provider !== "coinflow" || !env.COINFLOW_API_KEY || !env.COINFLOW_MERCHANT_ID) return;
  const res = await fetcher(`${apiRoot(env)}/subscription/${encodeURIComponent(env.COINFLOW_MERCHANT_ID)}/subscribers/${encodeURIComponent(s.providerRef)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", accept: "application/json", Authorization: env.COINFLOW_API_KEY },
    body: JSON.stringify({ status: "Canceled" }),
  });
  if (!res.ok) {
    console.error("[site] coinflow subscription cancel failed", s.id, res.status, (await res.text()).slice(0, 300));
    throw new CoinflowError("Couldn't cancel with the processor.", res.status);
  }
}

type SubEvent = CoinflowEvent & {
  data?: CoinflowEvent["data"] & {
    subscription?: { id?: string; _id?: string; status?: string; plan?: { code?: string }; planCode?: string; customer?: { email?: string } } | null;
    subscriptionId?: string;
    planCode?: string;
    email?: string;
    reason?: string;
    webhookInfo?: { topupId?: string; customerId?: string; kind?: string; tier?: string } | null;
  };
};

const subIdOf = (d: NonNullable<SubEvent["data"]>) => d.subscription?.id || d.subscription?._id || d.subscriptionId || (d.subscription === undefined ? undefined : d.id) || null;

/**
 * Subscription events, and payment events that belong to a subscription. Returns null when the
 * event isn't about a subscription (the top-up handler owns it).
 */
export type SubscriptionHooks = {
  /** A plan month was credited for this processor payment id (send the receipt). */
  onPaid?: (paymentId: string) => Promise<void>;
  /** The processor reported a subscription canceled (send the notice). */
  onCanceled?: (providerRef: string) => Promise<void>;
};

export async function handleCoinflowSubscriptionEvent(db: PrismaClient, ev: SubEvent, env: Env = process.env, hooks: SubscriptionHooks = {}): Promise<string | null> {
  const type = ev.eventType || "";
  const d = ev.data || {};
  const isSubEvent = type.startsWith("Subscription ");
  const subId = isSubEvent ? d.subscription?.id || d.subscription?._id || d.subscriptionId || d.id || null : subIdOf(d);

  if (type === "Subscription Created") {
    if (!subId) return "ignored:no_subscription";
    const tier = tierForPlan(d.subscription?.plan?.code || d.subscription?.planCode || d.planCode, env) || tierById(d.webhookInfo?.tier);
    let customerId = d.webhookInfo?.customerId || null;
    if (!customerId) {
      const email = (d.subscription?.customer?.email || d.email || "").toLowerCase();
      customerId = email ? ((await db.siteCustomer.findUnique({ where: { email } }))?.id ?? null) : null;
    }
    if (!tier || !customerId) return "ignored:unmatched_subscription";
    await startSubscription(db, { customerId, tier: tier.id, provider: "coinflow", providerRef: subId }).catch((e) => {
      if ((e as { code?: string }).code !== "exists") throw e;
    });
    return "subscription_created";
  }
  if (type === "Subscription Canceled") {
    if (!subId) return "ignored:no_subscription";
    const r = await markSubscription(db, subId, "CANCELED", d.reason);
    if (r === "canceled") await hooks.onCanceled?.(subId);
    return r;
  }
  if (type === "Subscription Expired") return subId ? markSubscription(db, subId, "EXPIRED") : "ignored:no_subscription";
  if (type === "Subscription Failure") return subId ? markSubscription(db, subId, "PAST_DUE", d.reason) : "ignored:no_subscription";

  if (type === "Settled" && (d.subscription || d.subscriptionId || d.webhookInfo?.kind === "cardbit_club")) {
    const ref = subId;
    const paymentId = d.paymentId || d.id;
    if (!ref || !paymentId) return "ignored:no_subscription";
    const cents = d.subtotal?.cents ?? d.totals?.subtotal?.cents ?? d.total?.cents;
    if (typeof cents !== "number") return "rejected:no_amount";
    const r = await creditSubscriptionPayment(db, { providerRef: ref, paymentId, cents, currency: d.subtotal?.currency });
    if (r === "credited") await hooks.onPaid?.(paymentId);
    return r;
  }
  if (type === "Refund") {
    const paymentId = d.paymentId || d.id;
    return paymentId ? reverseSubscriptionPayment(db, paymentId, "REFUND") : null;
  }
  if (type === "Card Payment Chargeback Opened") {
    const paymentId = d.id || d.paymentId;
    return paymentId ? reverseSubscriptionPayment(db, paymentId, "CHARGEBACK") : null;
  }
  return null;
}
