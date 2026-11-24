// Helpers for the throwaway stripe-test Railway environment only. Every caller returns 404
// unless this is that environment, the Stripe keys are test keys, and the customer is one of
// the configured QA customers. Production never sets RAILWAY_ENVIRONMENT_NAME=stripe-test
// (scripts/start-cardbit.sh would refuse to start it there).
import { CARDBIT_SHOP } from "../cardbit.server";
import { stripeConfig } from "./stripe.server";

export function stripeTestEnv(env = process.env) {
  if (env.RAILWAY_ENVIRONMENT_NAME !== "stripe-test" || env.CARDBIT_WORKSPACE_MODE) return null;
  const config = stripeConfig(CARDBIT_SHOP, env);
  if (!config || config.live) {
    // Names which setting is wrong, never its value.
    let prices = false;
    try {
      prices = !!JSON.parse(env.STRIPE_TOPUP_PRICES || "null");
    } catch {
      /* reported below */
    }
    console.error("stripe-test: Stripe settings incomplete", {
      shop: env.CARDBIT_STOREFRONT_SHOP === CARDBIT_SHOP,
      provider: env.CARDBIT_PAYMENT_PROVIDER === "stripe",
      secret: /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY ?? ""),
      publishable: /^pk_test_/.test(env.STRIPE_PUBLISHABLE_KEY ?? ""),
      webhook: /^whsec_/.test(env.STRIPE_WEBHOOK_SECRET ?? ""),
      prices,
      returnUrl: /^https:\/\/.*\{CHECKOUT_SESSION_ID\}/.test(env.STRIPE_TOPUP_RETURN_URL ?? ""),
    });
    return null;
  }
  const customers = (env.CARDBIT_QA_CUSTOMERS ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => /^gid:\/\/shopify\/Customer\/\d+$/.test(c));
  return customers.length ? { config, customers, shop: CARDBIT_SHOP } : null;
}

export const html = (body: string, title = "Cardbit Stripe test") =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{font:16px system-ui;max-width:720px;margin:24px auto;padding:0 16px;color:#111}code,pre{background:#f3f3f3;padding:2px 4px}pre{padding:12px;overflow:auto}button,select{font:inherit;padding:6px 10px;margin:4px 0}.banner{background:#fff3cd;padding:8px 12px;border-radius:6px}</style></head><body><p class="banner">Stripe TEST mode. No real money moves.</p>${body}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

export const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
