import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { balanceOf, postLedger } from "../core/ledger.server";
import { handleCoinflowSubscriptionEvent } from "../payments/coinflow-subscriptions.server";
import { cancelPlan } from "../core/admin-desk.server";
import { topupCentsSince } from "./limits.server";
import { sendPlanCanceledEmail, sendPlanPaymentEmail } from "./plan-emails.server";
import { PLAN, withPlanCopy } from "./plan-brand";
import { buybackBonusFor, claimFreeShip, passFreeShip } from "./pass-perks.server";
import { activeTier, activeTiers, monthlyCredit, requestCancel, subscriberBonusForOpening, subscriptionView, tierById, TIERS } from "./subscriptions.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const env = { SITE_SUBSCRIPTIONS: "on", SITE_COINFLOW_PLAN_PLUS: "cb-plus", SITE_COINFLOW_PLAN_PRO: "cb-pro", SITE_COINFLOW_PLAN_ULTIMATE: "cb-ult" } as NodeJS.ProcessEnv;
const wipe = async () => {
  await db.siteEmail.deleteMany({ where: { to: { endsWith: "@sub.test" } } });
  await db.siteStaffAction.deleteMany({ where: { requestId: { startsWith: "subtest" } } });
  await db.siteSubscriptionPayment.deleteMany();
  await db.siteSubscription.deleteMany();
  await db.sitePlayEvent.deleteMany({ where: { kind: "pass_free_ship" } });
  const ids = (await db.siteCustomer.findMany({ where: { email: { endsWith: "@sub.test" } }, select: { id: true } })).map((c) => c.id);
  await db.siteLedger.deleteMany({ where: { customerId: { in: ids } } });
  await db.siteWallet.deleteMany({ where: { customerId: { in: ids } } });
  await db.cardbitSparkTxn.deleteMany({ where: { shop: "sub-test" } });
  await db.cardbitSparkWallet.deleteMany({ where: { shop: "sub-test" } });
  await db.siteCustomer.deleteMany({ where: { email: { endsWith: "@sub.test" } } });
};

describe("tiers", () => {
  it("splits each month into paid and bonus Cardbits", () => {
    expect(monthlyCredit(tierById("plus")!)).toEqual({ paid: 2499, bonus: 126 });
    expect(monthlyCredit(tierById("pro")!)).toEqual({ paid: 4999, bonus: 376 });
    expect(monthlyCredit(tierById("ultimate")!)).toEqual({ paid: 19999, bonus: 2001 });
    expect(TIERS.map((t) => t.xpBonusPct)).toEqual([15, 25, 50]);
  });
});

describe.skipIf(!url)("Pack Pass subscriptions", () => {
  let customerId = "";
  const prev = process.env.SITE_SUBSCRIPTIONS;
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
    process.env.SITE_SUBSCRIPTIONS = "on";
  });
  beforeEach(async () => {
    await wipe();
    customerId = (await db.siteCustomer.create({ data: { email: "m@sub.test" } })).id;
  });
  afterAll(async () => {
    await wipe();
    process.env.SITE_SUBSCRIPTIONS = prev;
    await db.$disconnect();
  });

  const created = () =>
    handleCoinflowSubscriptionEvent(db, { eventType: "Subscription Created", data: { subscription: { id: "sub_1", plan: { code: "cb-pro" } }, webhookInfo: { customerId } } }, env);
  const settled = (paymentId: string, cents = 4999) =>
    handleCoinflowSubscriptionEvent(db, { eventType: "Settled", data: { id: paymentId, subtotal: { cents, currency: "USD" }, subscription: { id: "sub_1" } } }, env);

  it("credits each paid month once, with separate paid and bonus rows", async () => {
    expect(await created()).toBe("subscription_created");
    expect(await created()).toBe("subscription_created"); // duplicate webhook
    expect(await db.siteSubscription.count()).toBe(1);
    expect(await settled("pay_1")).toBe("credited");
    expect(await settled("pay_1")).toBe("replay");
    expect(await balanceOf(db, customerId)).toBe(5375);
    const kinds = (await db.siteLedger.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } })).map((l) => [l.kind, l.delta]);
    expect(kinds).toEqual([["SUBSCRIPTION", 4999], ["BONUS", 376]]);
    expect((await activeTier(db, customerId))?.id).toBe("pro");
    expect(await settled("pay_2")).toBe("credited");
    const s = await db.siteSubscription.findFirstOrThrow();
    expect(s.status).toBe("ACTIVE");
    // Two months paid: period ends about two months out.
    expect(s.currentPeriodEnd!.getTime() - Date.now()).toBeGreaterThan(55 * 86_400_000);
  });

  it("looks up many members' tiers at once and drops lapsed plans right away", async () => {
    await created();
    await settled("pay_1");
    const other = (await db.siteCustomer.create({ data: { email: "o@sub.test" } })).id;
    let tiers = await activeTiers(db, [customerId, other]);
    expect(tiers.get(customerId)?.id).toBe("pro");
    expect(tiers.has(other)).toBe(false);
    await db.siteSubscription.updateMany({ where: { customerId }, data: { status: "CANCELED", currentPeriodEnd: new Date(Date.now() - 60_000) } });
    tiers = await activeTiers(db, [customerId]);
    expect(tiers.size).toBe(0);
    expect(await activeTier(db, customerId)).toBeNull();
  });

  it("Pro gets one free shipment a month; Ultimate two plus the buyback bonus", async () => {
    expect(await passFreeShip(db, customerId)).toBeNull();
    await created();
    await settled("pay_1");
    const perk = await passFreeShip(db, customerId);
    expect(perk).toEqual({ kind: "monthly", tier: "pro", left: 1 });
    expect(await db.$transaction((tx) => claimFreeShip(tx, customerId, "ship_a", perk!))).toBe(true);
    expect(await db.$transaction((tx) => claimFreeShip(tx, customerId, "ship_b", perk!))).toBe(false);
    expect(await passFreeShip(db, customerId)).toBeNull();
    expect(await buybackBonusFor(db, customerId)).toBe(0);
    await db.siteSubscription.updateMany({ where: { customerId }, data: { tier: "ultimate" } });
    // Ultimate: 2 a month, and the Pro one already used this month counts.
    expect(await passFreeShip(db, customerId)).toEqual({ kind: "monthly", tier: "ultimate", left: 1 });
    const ult = (await passFreeShip(db, customerId))!;
    expect(await db.$transaction((tx) => claimFreeShip(tx, customerId, "ship_c", ult))).toBe(true);
    expect(await db.$transaction((tx) => claimFreeShip(tx, customerId, "ship_d", ult))).toBe(false);
    expect(await passFreeShip(db, customerId)).toBeNull();
    expect(await buybackBonusFor(db, customerId)).toBe(0.05);
  });

  it("rejects a wrong amount and ignores unknown subscriptions", async () => {
    await created();
    expect(await settled("pay_x", 100)).toBe("rejected:amount_mismatch");
    expect(await handleCoinflowSubscriptionEvent(db, { eventType: "Settled", data: { id: "p", subtotal: { cents: 4999 }, subscription: { id: "nope" } } }, env)).toBe("ignored:unknown_subscription");
    expect(await handleCoinflowSubscriptionEvent(db, { eventType: "Settled", data: { id: "p", subtotal: { cents: 4999 }, webhookInfo: { topupId: "t1" } } }, env)).toBeNull();
  });

  it("claws back a refund, freezes on chargeback, and keeps perks until a canceled month ends", async () => {
    await created();
    await settled("pay_1");
    await postLedger(db, { customerId, delta: -5000, kind: "PACK", idempotencyKey: "spend1" });
    expect(await handleCoinflowSubscriptionEvent(db, { eventType: "Refund", data: { paymentId: "pay_1" } }, env)).toBe("refund:owed_5000");
    expect(await balanceOf(db, customerId)).toBe(0);
    expect(await handleCoinflowSubscriptionEvent(db, { eventType: "Refund", data: { paymentId: "pay_1" } }, env)).toBe("replay");
    await settled("pay_2");
    expect(await handleCoinflowSubscriptionEvent(db, { eventType: "Card Payment Chargeback Opened", data: { id: "pay_2" } }, env)).toBe("chargeback");
    expect((await db.siteCustomer.findUniqueOrThrow({ where: { id: customerId } })).frozenAt).not.toBeNull();
    expect((await db.siteSubscription.findFirstOrThrow()).status).toBe("CANCELED");
    expect((await activeTier(db, customerId))?.id).toBe("pro"); // paid month still running
  });

  it("cancels at the processor and marks renewal off; lifecycle events update status", async () => {
    await created();
    await settled("pay_1");
    const calls: string[] = [];
    await requestCancel(db, customerId, async (s) => void calls.push(s.providerRef));
    expect(calls).toEqual(["sub_1"]);
    const v = await subscriptionView(db, customerId);
    expect(v.current).toMatchObject({ tier: "pro", status: "CANCELED" });
    expect(v.perksTier).toBe("pro");
    expect(await handleCoinflowSubscriptionEvent(db, { eventType: "Subscription Expired", data: { subscription: { id: "sub_1" } } }, env)).toBe("expired");
  });

  it("passes paid months and processor cancels to the email hooks, and emails once each", async () => {
    await created();
    const paid: string[] = [];
    const canceled: string[] = [];
    const hooks = { onPaid: async (id: string) => void paid.push(id), onCanceled: async (ref: string) => void canceled.push(ref) };
    await handleCoinflowSubscriptionEvent(db, { eventType: "Settled", data: { id: "pay_1", subtotal: { cents: 4999 }, subscription: { id: "sub_1" } } }, env, hooks);
    await handleCoinflowSubscriptionEvent(db, { eventType: "Settled", data: { id: "pay_1", subtotal: { cents: 4999 }, subscription: { id: "sub_1" } } }, env, hooks);
    expect(paid).toEqual(["pay_1"]);
    const sent: string[] = [];
    const deps = { db, mailer: { live: true, send: async (m: { subject: string }) => (sent.push(m.subject), { id: "m" }) }, env: {} };
    await sendPlanPaymentEmail(db, "pay_1", deps);
    await sendPlanPaymentEmail(db, "pay_1", deps);
    expect(sent).toEqual([`Welcome to ${PLAN.name} Pro`]);
    await handleCoinflowSubscriptionEvent(db, { eventType: "Subscription Canceled", data: { subscription: { id: "sub_1" } } }, env, hooks);
    await handleCoinflowSubscriptionEvent(db, { eventType: "Subscription Canceled", data: { subscription: { id: "sub_1" } } }, env, hooks);
    expect(canceled).toEqual(["sub_1"]);
    const s = await db.siteSubscription.findFirstOrThrow();
    await sendPlanCanceledEmail(db, s.id, deps);
    await sendPlanCanceledEmail(db, s.id, deps);
    expect(sent).toEqual([`Welcome to ${PLAN.name} Pro`, `${PLAN.name} Pro Renewal Canceled`]);
  });

  it("counts plan charges toward Top-Up Limits", async () => {
    await created();
    await settled("pay_1");
    expect(await topupCentsSince(db, customerId, new Date(Date.now() - 86_400_000))).toBe(4999);
    await handleCoinflowSubscriptionEvent(db, { eventType: "Refund", data: { paymentId: "pay_1" } }, env);
    expect(await topupCentsSince(db, customerId, new Date(Date.now() - 86_400_000))).toBe(0);
  });

  it("lets staff cancel a plan once per request, even when the processor refuses", async () => {
    await created();
    await settled("pay_1");
    const r = await cancelPlan(db, "staff@test", { customerId, reason: "customer asked", requestId: "subtest-cancel-1" }, async () => {
      throw new Error("down");
    });
    expect(r).toMatchObject({ replay: false, processorCanceled: false });
    expect((await db.siteSubscription.findFirstOrThrow()).cancelReason).toBe("staff_processor_cancel_failed");
    expect(await cancelPlan(db, "staff@test", { customerId, reason: "customer asked", requestId: "subtest-cancel-1" }, async () => {})).toMatchObject({ replay: true });
    await expect(cancelPlan(db, "staff@test", { customerId, reason: "again", requestId: "subtest-cancel-2" }, async () => {})).rejects.toThrow("no plan");
    expect((await activeTier(db, customerId))?.id).toBe("pro");
  });

  it("adds subscriber XP and Sparks once per opening", async () => {
    await created();
    await settled("pay_1");
    const xpCalls: unknown[] = [];
    const run = () =>
      db.$transaction((tx) => subscriberBonusForOpening(tx, "sub-test", customerId, "open1", { xp: 100, sparks: 40 }, { xp: async (i) => void xpCalls.push(i) }));
    expect(await run()).toEqual({ xp: 25, sparks: 4 });
    expect(await run()).toEqual({ xp: 25, sparks: 4 });
    expect(await db.cardbitSparkTxn.count({ where: { shop: "sub-test" } })).toBe(1);
    expect((await db.cardbitSparkWallet.findFirstOrThrow({ where: { shop: "sub-test" } })).balance).toBe(4);
  });
});

describe("plan copy", () => {
  const html = "<p>A</p><!--plan:start--><p>{{PLAN_NAME}} at {{PLAN_PATH}}</p><!--plan:end--><p>the {{PLAN_SHORT}} room</p>";
  it("hides plan-only blocks until plans open and fills the name", () => {
    expect(withPlanCopy(html, false)).toBe(`<p>A</p><p>the ${PLAN.short} room</p>`);
    expect(withPlanCopy(html, true)).toBe(`<p>A</p><p>${PLAN.name} at ${PLAN.path}</p><p>the ${PLAN.short} room</p>`);
  });
});
