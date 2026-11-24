import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { CARDBIT_SHOP as shop } from "../cardbit.server";
import { stripeConfig, verifyTopupSession, withStripeTopups, type StripeConfig } from "./stripe.server";

const prices = {
  "50950076727458": "price_ten",
  "50950076792994": "price_hundred",
};
const env = {
  CARDBIT_STOREFRONT_SHOP: shop,
  CARDBIT_PAYMENT_PROVIDER: "stripe",
  STRIPE_SECRET_KEY: "sk_test_abc",
  STRIPE_PUBLISHABLE_KEY: "pk_test_abc",
  STRIPE_WEBHOOK_SECRET: "whsec_abc",
  STRIPE_TOPUP_PRICES: JSON.stringify(prices),
} as NodeJS.ProcessEnv;

describe("stripeConfig", () => {
  it("turns on only for Cardbit with complete test keys", () => {
    expect(stripeConfig(shop, env)).toMatchObject({ live: false, prices });
    expect(stripeConfig("poke-collect-al.myshopify.com", env)).toBeNull();
    expect(stripeConfig(shop, { ...env, CARDBIT_PAYMENT_PROVIDER: "" })).toBeNull();
    expect(stripeConfig(shop, { ...env, STRIPE_WEBHOOK_SECRET: "" })).toBeNull();
    expect(stripeConfig(shop, { ...env, STRIPE_PUBLISHABLE_KEY: "pk_live_abc" })).toBeNull();
  });
  it("refuses live keys without Trevor's explicit approval flag", () => {
    const live = { ...env, STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_PUBLISHABLE_KEY: "pk_live_abc" };
    expect(stripeConfig(shop, live)).toBeNull();
    expect(stripeConfig(shop, { ...live, CARDBIT_STRIPE_LIVE_APPROVED: "yes" })).toMatchObject({ live: true });
  });
  it("rejects prices for unknown packages and bad return URLs", () => {
    expect(stripeConfig(shop, { ...env, STRIPE_TOPUP_PRICES: '{"123":"price_x"}' })).toBeNull();
    expect(stripeConfig(shop, { ...env, STRIPE_TOPUP_PRICES: "not json" })).toBeNull();
    expect(stripeConfig(shop, { ...env, STRIPE_TOPUP_RETURN_URL: "https://cardbit.com/done" })).toBeNull();
  });
});

describe("verifyTopupSession", () => {
  const config = stripeConfig(shop, env) as StripeConfig;
  const customer = "gid://shopify/Customer/7";
  const session = {
    id: "cs_test_1",
    status: "complete",
    payment_status: "paid",
    mode: "payment",
    currency: "usd",
    amount_total: 10000,
    livemode: false,
    payment_intent: "pi_test_123456",
    metadata: { shop, customer, variant: "50950076792994" },
    line_items: { has_more: false, data: [{ quantity: 1, price: { id: "price_hundred" } }] },
  } as Parameters<typeof verifyTopupSession>[0];

  it("accepts a paid session that matches the package exactly", () => {
    expect(verifyTopupSession(session, config, shop)).toEqual({
      provider: "stripe",
      paymentId: "pi_test_123456",
      customerId: customer,
      variant: "50950076792994",
      paidCents: 10000,
    });
  });
  it.each([
    ["unpaid", { payment_status: "unpaid" }],
    ["open", { status: "open" }],
    ["wrong amount", { amount_total: 9999 }],
    ["wrong currency", { currency: "cad" }],
    ["live event on test keys", { livemode: true }],
    ["other shop", { metadata: { ...session.metadata, shop: "other.myshopify.com" } }],
    ["bad customer", { metadata: { ...session.metadata, customer: "7" } }],
    ["unknown package", { metadata: { ...session.metadata, variant: "1" } }],
    ["swapped price", { line_items: { has_more: false, data: [{ quantity: 1, price: { id: "price_ten" } }] } }],
    ["two units", { line_items: { has_more: false, data: [{ quantity: 2, price: { id: "price_hundred" } }] } }],
    ["no line items", { line_items: null }],
    ["no payment", { payment_intent: null }],
  ])("rejects %s", (_name, change) => {
    expect(verifyTopupSession({ ...session, ...change } as typeof session, config, shop)).toBeNull();
  });
});

describe("Stripe webhook signatures", () => {
  it("only accepts events signed with the endpoint secret", () => {
    const stripe = new Stripe("sk_test_abc");
    const payload = JSON.stringify({ id: "evt_1", object: "event", type: "checkout.session.completed" });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_abc" });
    expect(stripe.webhooks.constructEvent(payload, header, "whsec_abc").id).toBe("evt_1");
    expect(() => stripe.webhooks.constructEvent(payload, header, "whsec_other")).toThrow();
    expect(() => stripe.webhooks.constructEvent(payload.replace("evt_1", "evt_2"), header, "whsec_abc")).toThrow();
  });
});

describe("withStripeTopups", () => {
  it("offers only priced packages through Stripe, and leaves the wallet alone when Stripe is off", () => {
    const view = { enabled: true, checkoutReady: false, topups: [] as unknown[] };
    expect(withStripeTopups(view, shop, env)).toMatchObject({
      payment: "stripe",
      checkoutReady: true,
      topups: [
        { variant: "50950076727458", amount: 1000, bonus: 0 },
        { variant: "50950076792994", amount: 10000, bonus: 500 },
      ],
    });
    expect(withStripeTopups(view, shop, { ...env, CARDBIT_PAYMENT_PROVIDER: "" })).toBe(view);
    expect(withStripeTopups({ enabled: false }, shop, env)).toEqual({ enabled: false });
  });
  it("returns shoppers to the storefront wallet by default", () => {
    expect(stripeConfig(shop, env)?.returnUrl).toBe("https://cardbit.com/?cb=cardbits&topup={CHECKOUT_SESSION_ID}");
  });
});
