import { describe, expect, it } from "vitest";
import { CARDBIT_SHOP as shop } from "../cardbit.server";
import { stripeTestEnv } from "./stripe-test-env.server";

const env = {
  CARDBIT_STOREFRONT_SHOP: shop,
  RAILWAY_ENVIRONMENT_NAME: "stripe-test",
  CARDBIT_PAYMENT_PROVIDER: "stripe",
  STRIPE_SECRET_KEY: "sk_test_abc",
  STRIPE_PUBLISHABLE_KEY: "pk_test_abc",
  STRIPE_WEBHOOK_SECRET: "whsec_abc",
  STRIPE_TOPUP_PRICES: JSON.stringify({ "50950076727458": "price_ten" }),
  CARDBIT_QA_CUSTOMERS: "gid://shopify/Customer/1, not-a-gid",
} as NodeJS.ProcessEnv;

describe("stripeTestEnv", () => {
  it("only opens in the stripe-test environment with test keys and QA customers", () => {
    expect(stripeTestEnv(env)?.customers).toEqual(["gid://shopify/Customer/1"]);
    expect(stripeTestEnv({ ...env, RAILWAY_ENVIRONMENT_NAME: "production" })).toBeNull();
    expect(stripeTestEnv({ ...env, CARDBIT_WORKSPACE_MODE: "live" })).toBeNull();
    expect(stripeTestEnv({ ...env, CARDBIT_QA_CUSTOMERS: "" })).toBeNull();
    expect(
      stripeTestEnv({ ...env, STRIPE_SECRET_KEY: "sk_live_x", STRIPE_PUBLISHABLE_KEY: "pk_live_x", CARDBIT_STRIPE_LIVE_APPROVED: "yes" }),
    ).toBeNull();
  });
});
