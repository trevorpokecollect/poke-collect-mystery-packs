import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { balanceOf } from "../core/ledger.server";
import { topupPackage } from "./coinflow.server";
import { handleSiteStripeEvent, siteStripeConfig, topupProvider } from "./stripe-site.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const config = { secretKey: "sk_test_x", webhookSecret: "whsec_x", live: false };

describe("site stripe config", () => {
  it("refuses live keys without approval and defaults to Coinflow", () => {
    const live = { SITE_STRIPE_SECRET_KEY: "sk_live_x", SITE_STRIPE_WEBHOOK_SECRET: "whsec_x" } as never;
    expect(siteStripeConfig(live)).toBeNull();
    expect(siteStripeConfig({ ...(live as object), SITE_STRIPE_LIVE_APPROVED: "yes" } as never)?.live).toBe(true);
    expect(topupProvider({} as never)).toBe("coinflow");
    expect(topupProvider({ SITE_PAYMENT_PROVIDER: "stripe", SITE_STRIPE_SECRET_KEY: "sk_test_x", SITE_STRIPE_WEBHOOK_SECRET: "whsec_x" } as never)).toBe("stripe");
  });
});

describe.skipIf(!url)("site stripe events", () => {
  let customerId = "";
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(async () => {
    await db.siteTopup.deleteMany();
    await db.siteLedger.deleteMany();
    await db.siteWallet.deleteMany();
    await db.siteCustomer.deleteMany({ where: { email: "s@stripe.test" } });
    customerId = (await db.siteCustomer.create({ data: { email: "s@stripe.test" } })).id;
  });
  afterAll(() => db.$disconnect());

  it("credits once from the re-read session, then claws back a refund", async () => {
    const t = await db.siteTopup.create({ data: { customerId, ...topupPackage(10000)!, provider: "stripe", billingState: "TX", billingZip: "75001" } });
    const session = { id: "cs_1", status: "complete", payment_status: "paid", mode: "payment", currency: "usd", amount_total: 10000, payment_intent: "pi_1", metadata: { topupId: t.id, customerId, site: "cardbit-site" } };
    const stripe = { checkout: { sessions: { retrieve: async () => session } } } as never;
    const ev = { livemode: false, type: "checkout.session.completed", data: { object: { id: "cs_1" } } } as never;
    expect(await handleSiteStripeEvent({ db }, stripe, config, ev)).toBe("credited");
    expect(await handleSiteStripeEvent({ db }, stripe, config, ev)).toBe("replay");
    expect(await balanceOf(db, customerId)).toBe(10500);
    const refund = { livemode: false, type: "charge.refunded", data: { object: { payment_intent: "pi_1", amount_refunded: 10000 }, previous_attributes: { amount_refunded: 0 } } } as never;
    expect(await handleSiteStripeEvent({ db }, stripe, config, refund)).toBe("refunded");
    expect(await balanceOf(db, customerId)).toBe(0);
  });

  it("ignores events from the other mode and unpaid sessions", async () => {
    const t = await db.siteTopup.create({ data: { customerId, ...topupPackage(1000)!, provider: "stripe", billingState: "TX", billingZip: "75001" } });
    const session = { status: "open", payment_status: "unpaid", mode: "payment", currency: "usd", amount_total: 1000, payment_intent: null, metadata: { topupId: t.id, site: "cardbit-site" } };
    const stripe = { checkout: { sessions: { retrieve: async () => session } } } as never;
    expect(await handleSiteStripeEvent({ db }, stripe, config, { livemode: true, type: "checkout.session.completed", data: { object: { id: "x" } } } as never)).toBe("ignored:mode");
    expect(await handleSiteStripeEvent({ db }, stripe, config, { livemode: false, type: "checkout.session.completed", data: { object: { id: "x" } } } as never)).toBe("not_paid");
    expect(await balanceOf(db, customerId)).toBe(0);
  });
});
