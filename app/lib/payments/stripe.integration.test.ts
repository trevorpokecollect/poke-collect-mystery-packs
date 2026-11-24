import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CARDBIT_SHOP as shop } from "../cardbit.server";
import { walletView } from "../cardbits.server";
import { handleStripeEvent, stripeConfig, type StripeConfig } from "./stripe.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({
  datasources: { db: { url: url || "postgresql://localhost/disabled_test" } },
});
const who = "gid://shopify/Customer/88401",
  intruder = "gid://shopify/Customer/88402";
const variant = "50950076792994"; // $100 → 10,000 + 500 bonus

describe.skipIf(!url)("Stripe top-ups on disposable Postgres", () => {
  let config: StripeConfig;
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "ignore",
    });
    vi.stubEnv("CARDBIT_STOREFRONT_SHOP", shop);
    vi.stubEnv("CARDBIT_WORKSPACE_MODE", "live");
    vi.stubEnv("RAILWAY_PROJECT_NAME", "cardbit-mystery-packs");
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
    vi.stubEnv("RAILWAY_SERVICE_NAME", "app");
    config = stripeConfig(shop, {
      ...process.env,
      CARDBIT_PAYMENT_PROVIDER: "stripe",
      STRIPE_SECRET_KEY: "sk_test_x",
      STRIPE_PUBLISHABLE_KEY: "pk_test_x",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
      STRIPE_TOPUP_PRICES: JSON.stringify({ [variant]: "price_hundred" }),
    })!;
  });
  afterAll(async () => {
    await db.cardbitReceipt.deleteMany({ where: { shop, customerId: { in: [who, intruder] } } });
    await db.cardbitWallet.deleteMany({ where: { shop, customerId: { in: [who, intruder] } } });
    vi.unstubAllEnvs();
    await db.$disconnect();
  });

  const fakeStripe = (session: Record<string, unknown>) =>
    ({
      checkout: { sessions: { retrieve: async () => session } },
      charges: { retrieve: async () => ({ payment_intent: session.payment_intent }) },
    }) as unknown as Pick<Stripe, "checkout" | "charges">;
  const event = (type: string, object: Record<string, unknown>) =>
    ({ id: "evt_" + type, type, livemode: false, data: { object } }) as unknown as Stripe.Event;
  const paidSession = (pi: string, customer = who, amount = 10000) => ({
    id: "cs_test_" + pi,
    status: "complete",
    payment_status: "paid",
    mode: "payment",
    currency: "usd",
    amount_total: amount,
    livemode: false,
    payment_intent: pi,
    metadata: { shop, customer, variant },
    line_items: { has_more: false, data: [{ quantity: 1, price: { id: "price_hundred" } }] },
  });
  const ledger = async (customerId: string) =>
    (await db.cardbitReceipt.findMany({ where: { shop, customerId }, orderBy: { createdAt: "asc" } }))
      .map((r) => [r.kind, r.delta])
      .sort();

  it("credits once across duplicate and concurrent events, with the bonus kept separate", async () => {
    const pi = "pi_test_dup_" + Date.now();
    const s = fakeStripe(paidSession(pi));
    const completed = event("checkout.session.completed", { id: "cs_test_" + pi });
    const results = await Promise.all([
      handleStripeEvent(db, s, config, shop, completed),
      handleStripeEvent(db, s, config, shop, completed),
      handleStripeEvent(db, s, config, shop, event("checkout.session.async_payment_succeeded", { id: "cs_test_" + pi })),
    ]);
    // Concurrent deliveries may each report success; the ledger decides what was credited.
    expect(results.every((r) => r === "credited" || r === "already-credited")).toBe(true);
    expect(await handleStripeEvent(db, s, config, shop, completed)).toBe("already-credited");
    expect(await ledger(who)).toEqual([
      ["topup", 10000],
      ["topup-bonus", 500],
    ]);
    expect(await walletView(db, shop, who)).toMatchObject({ balance: 10500, held: false });
  });

  it("credits nothing for unpaid, mismatched or test-vs-live sessions", async () => {
    const pi = "pi_test_bad_" + Date.now();
    const cases = [
      { ...paidSession(pi, intruder), payment_status: "unpaid" },
      paidSession(pi, intruder, 100),
      { ...paidSession(pi, intruder), livemode: true },
    ];
    for (const session of cases)
      expect(
        await handleStripeEvent(db, fakeStripe(session), config, shop, event("checkout.session.completed", { id: "x" })),
      ).toBe("not-verified");
    const liveEvent = { ...event("checkout.session.completed", { id: "x" }), livemode: true } as Stripe.Event;
    expect(await handleStripeEvent(db, fakeStripe(paidSession(pi, intruder)), config, shop, liveEvent)).toBe("ignored");
    expect(await ledger(intruder)).toEqual([]);
  });

  it("holds on a dispute, then takes back paid and bonus Cardbits once when it is lost", async () => {
    const pi = "pi_test_dispute_" + Date.now();
    const s = fakeStripe(paidSession(pi));
    await handleStripeEvent(db, s, config, shop, event("checkout.session.completed", { id: "cs_test_" + pi }));
    const before = (await walletView(db, shop, who)) as { balance: number };
    expect(
      await handleStripeEvent(db, s, config, shop, event("charge.dispute.created", { payment_intent: pi })),
    ).toBe("held");
    expect(await walletView(db, shop, who)).toMatchObject({ held: true, balance: before.balance });
    const lost = event("charge.dispute.closed", { payment_intent: pi, status: "lost" });
    await Promise.all([
      handleStripeEvent(db, s, config, shop, lost),
      handleStripeEvent(db, s, config, shop, lost),
    ]);
    expect(await walletView(db, shop, who)).toMatchObject({ held: true, balance: before.balance - 10500 });
    const reversals = await db.cardbitReceipt.findMany({
      where: { shop, eventKey: { in: ["reverse:stripe:" + pi, "reverse-bonus:stripe:" + pi] } },
    });
    expect(reversals.map((r) => [r.kind, r.delta]).sort()).toEqual([
      ["topup-bonus-reversal", -500],
      ["topup-reversal", -10000],
    ]);
  });

  it("reverses a full refund even after the Cardbits were spent, and only holds a partial one", async () => {
    const customer = intruder;
    const full = "pi_test_refund_" + Date.now();
    const s = fakeStripe(paidSession(full, customer));
    await handleStripeEvent(db, s, config, shop, event("checkout.session.completed", { id: "cs_test_" + full }));
    // Simulate the shopper having spent everything.
    await db.cardbitWallet.update({ where: { shop_customerId: { shop, customerId: customer } }, data: { balance: 0 } });
    expect(
      await handleStripeEvent(
        db, s, config, shop,
        event("charge.refunded", { payment_intent: full, refunded: true, amount: 10000, amount_refunded: 10000 }),
      ),
    ).toBe("reversed");
    expect(await walletView(db, shop, customer)).toMatchObject({ held: true, balance: 0 });
    const spent = await db.cardbitReceipt.findUniqueOrThrow({
      where: { shop_eventKey: { shop, eventKey: "reverse:stripe:" + full } },
    });
    expect(spent).toMatchObject({ delta: 0, reason: "Refunded in Stripe; 10000 Cardbits already spent and owed" });

    const partial = "pi_test_partial_" + Date.now();
    const p = fakeStripe(paidSession(partial, customer));
    await handleStripeEvent(db, p, config, shop, event("checkout.session.completed", { id: "cs_test_" + partial }));
    expect(
      await handleStripeEvent(
        db, p, config, shop,
        event("charge.refunded", { payment_intent: partial, refunded: false, amount: 10000, amount_refunded: 2500 }),
      ),
    ).toBe("held");
    expect(await walletView(db, shop, customer)).toMatchObject({ held: true, balance: 10500 });
  });

  it("ignores refunds and disputes for payments it never credited", async () => {
    const s = fakeStripe(paidSession("pi_test_unknown"));
    expect(
      await handleStripeEvent(db, s, config, shop, event("charge.refunded", { payment_intent: "pi_test_unknown", refunded: true, amount: 1, amount_refunded: 1 })),
    ).toBe("ignored");
    expect(
      await handleStripeEvent(db, s, config, shop, event("charge.dispute.created", { payment_intent: "pi_test_unknown" })),
    ).toBe("ignored");
  });
});
