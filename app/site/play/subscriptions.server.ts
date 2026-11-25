// Cardbit Club subscriptions (standalone site). Trevor, Nov 24 2026: Boxed.gg-style monthly plans that
// give guaranteed Cardbits + a bonus each month, faster XP, bonus Sparks, animated icons and a chat perk.
//
// Guardrails:
// - OFF unless SITE_SUBSCRIPTIONS=on. Sign-ups also need Coinflow plans (SITE_COINFLOW_PLAN_<TIER>)
//   and stay in sandbox unless the site is live-approved (scripts/start-cardbit-site.sh).
// - A subscription never adds Daily Spins, giveaway entries or leaderboard points. Sweepstakes stay
//   free to enter on equal terms.
// - Each paid month credits the wallet once per processor payment id: SUBSCRIPTION (paid part) and
//   BONUS (promotional part) as separate ledger rows. Refunds/chargebacks claw back like top-ups.
// - A cool-off or self-exclusion cancels renewal at the processor and pauses perks' purchases.
import type { Prisma, PrismaClient, SiteSubscription } from "@prisma/client";
import { applyLedger, balanceOf } from "../core/ledger.server";

type Db = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

export type TierId = "plus" | "pro" | "ultimate";
export type Tier = {
  id: TierId;
  name: string;
  cents: number;
  /** Marketing amount (e.g. 2,500 + 125). Paid part = cents; the rest is recorded as BONUS. */
  monthlyBits: number;
  bonusBits: number;
  xpBonusPct: number;
  sparksBonusPct: number;
};

export const TIERS: Tier[] = [
  { id: "plus", name: "Plus", cents: 2499, monthlyBits: 2500, bonusBits: 125, xpBonusPct: 15, sparksBonusPct: 5 },
  { id: "pro", name: "Pro", cents: 4999, monthlyBits: 5000, bonusBits: 375, xpBonusPct: 25, sparksBonusPct: 10 },
  { id: "ultimate", name: "Ultimate", cents: 19999, monthlyBits: 20000, bonusBits: 2000, xpBonusPct: 50, sparksBonusPct: 15 },
];
export const tierById = (id: unknown) => TIERS.find((t) => t.id === id) ?? null;
/** Ledger split for one paid month: paid Cardbits = dollars paid (100/$1); everything above is bonus. */
export const monthlyCredit = (t: Tier) => ({ paid: t.cents, bonus: t.monthlyBits + t.bonusBits - t.cents });

export const subscriptionsOn = (env: NodeJS.ProcessEnv = process.env) => env.SITE_SUBSCRIPTIONS === "on";
export const ACTIVE_STATUSES = ["ACTIVE", "PAST_DUE"] as const;
/** Perks continue this long after a missed renewal while the processor retries. */
const GRACE_MS = 3 * 86_400_000;

export class SubscriptionError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) {
    super(message);
    this.name = "SubscriptionError";
  }
}

/** The customer's current subscription row (active, past due or pending), if any. */
export async function currentSubscription(db: Db, customerId: string) {
  return db.siteSubscription.findFirst({
    where: { customerId, status: { in: ["PENDING", "ACTIVE", "PAST_DUE"] } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Tier whose perks apply right now: paid through the current month (also after a cancel, until the
 * month ends), plus a short grace while a failed renewal is retried.
 */
export async function activeTier(db: Db, customerId: string, now = new Date()): Promise<Tier | null> {
  if (!subscriptionsOn()) return null;
  const s = await db.siteSubscription.findFirst({
    where: { customerId, status: { in: ["ACTIVE", "PAST_DUE", "CANCELED"] }, currentPeriodEnd: { gt: new Date(now.getTime() - GRACE_MS) } },
    orderBy: { currentPeriodEnd: "desc" },
  });
  if (!s?.currentPeriodEnd) return null;
  const until = s.currentPeriodEnd.getTime() + (s.status === "PAST_DUE" ? GRACE_MS : 0);
  return until > now.getTime() ? tierById(s.tier) : null;
}

/** Record a sign-up started with the processor (first payment then confirms it via webhook). */
export async function startSubscription(db: PrismaClient, input: { customerId: string; tier: TierId; provider: string; providerRef: string }) {
  const tier = tierById(input.tier);
  if (!tier) throw new SubscriptionError("invalid", "Choose a plan.", 400);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`site-customer:${input.customerId}`}, 0))::text`;
    const cur = await currentSubscription(tx, input.customerId);
    if (cur && cur.providerRef !== input.providerRef) throw new SubscriptionError("exists", "You already have a Cardbit Club plan. Cancel it before switching.");
    if (cur) return cur;
    return tx.siteSubscription.create({ data: { customerId: input.customerId, tier: tier.id, provider: input.provider, providerRef: input.providerRef, status: "PENDING" } });
  });
}

async function lockSub(tx: Tx, providerRef: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "SiteSubscription" WHERE "providerRef" = ${providerRef} FOR UPDATE`;
  return rows.length ? tx.siteSubscription.findUniqueOrThrow({ where: { id: rows[0].id } }) : null;
}

const addMonth = (d: Date) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + 1);
  return x;
};

/**
 * One paid month (first payment or renewal). Idempotent per processor payment id. The amount must
 * match the plan exactly. Returns "credited", "replay" or an "ignored:"/"rejected:" reason.
 */
export async function creditSubscriptionPayment(
  db: PrismaClient,
  input: { providerRef: string; paymentId: string; cents: number; currency?: string; paidAt?: Date },
): Promise<string> {
  return db.$transaction(async (tx) => {
    const s = await lockSub(tx, input.providerRef);
    if (!s) return "ignored:unknown_subscription";
    const tier = tierById(s.tier);
    if (!tier) return "rejected:unknown_tier";
    const prior = await tx.siteSubscriptionPayment.findUnique({ where: { paymentId: input.paymentId } });
    if (prior) return "replay";
    if (input.cents !== tier.cents || (input.currency || "USD").toUpperCase() !== "USD") {
      console.error("[site] subscription amount mismatch", s.id, input.cents, input.currency);
      return "rejected:amount_mismatch";
    }
    const paidAt = input.paidAt ?? new Date();
    const start = s.currentPeriodEnd && s.currentPeriodEnd > paidAt ? s.currentPeriodEnd : paidAt;
    const end = addMonth(start);
    const { paid, bonus } = monthlyCredit(tier);
    const pay = await tx.siteSubscriptionPayment.create({
      data: { subscriptionId: s.id, customerId: s.customerId, paymentId: input.paymentId, cents: tier.cents, paidBits: paid, bonusBits: bonus, periodStart: start, periodEnd: end },
    });
    await applyLedger(tx, { customerId: s.customerId, delta: paid, kind: "SUBSCRIPTION", idempotencyKey: `sub:${pay.id}:paid`, ref: input.paymentId, note: `Cardbit Club ${tier.name} monthly Cardbits` });
    if (bonus > 0)
      await applyLedger(tx, { customerId: s.customerId, delta: bonus, kind: "BONUS", idempotencyKey: `sub:${pay.id}:bonus`, ref: input.paymentId, note: `Cardbit Club ${tier.name} bonus` });
    await tx.siteSubscription.update({ where: { id: s.id }, data: { status: s.status === "CANCELED" ? "CANCELED" : "ACTIVE", currentPeriodEnd: end } });
    return "credited";
  });
}

/** Processor says the subscription ended (canceled, expired) or a renewal failed. */
export async function markSubscription(db: PrismaClient, providerRef: string, status: "CANCELED" | "EXPIRED" | "PAST_DUE", reason?: string) {
  return db.$transaction(async (tx) => {
    const s = await lockSub(tx, providerRef);
    if (!s) return "ignored:unknown_subscription";
    if (s.status === status || s.status === "EXPIRED") return "replay";
    await tx.siteSubscription.update({
      where: { id: s.id },
      data: { status, canceledAt: status === "PAST_DUE" ? s.canceledAt : (s.canceledAt ?? new Date()), cancelReason: reason?.slice(0, 200) ?? s.cancelReason },
    });
    return status.toLowerCase();
  });
}

/** Refund or chargeback of one subscription payment: take back what's left, record the rest as owed. */
export async function reverseSubscriptionPayment(db: PrismaClient, paymentId: string, kind: "REFUND" | "CHARGEBACK") {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "SiteSubscriptionPayment" WHERE "paymentId" = ${paymentId} FOR UPDATE`;
    if (!rows.length) return "ignored:unknown_payment";
    const p = await tx.siteSubscriptionPayment.findUniqueOrThrow({ where: { id: rows[0].id } });
    const key = `${kind.toLowerCase()}:sub:${p.id}`;
    if (await tx.siteLedger.findUnique({ where: { idempotencyKey: key } })) return "replay";
    const want = p.paidBits + p.bonusBits - p.clawedBits;
    const balance = await balanceOf(tx, p.customerId);
    const taken = Math.max(0, Math.min(balance, want));
    if (taken > 0) await applyLedger(tx, { customerId: p.customerId, delta: -taken, kind, idempotencyKey: key, ref: p.id, note: `Cardbit Club ${kind.toLowerCase()}` });
    await tx.siteSubscriptionPayment.update({ where: { id: p.id }, data: { status: kind === "REFUND" ? "REFUNDED" : "CHARGEBACK", clawedBits: { increment: taken }, owedBits: { increment: want - taken } } });
    if (kind === "CHARGEBACK") {
      await tx.siteCustomer.update({ where: { id: p.customerId }, data: { frozenAt: new Date() } });
      await tx.siteSubscription.update({ where: { id: p.subscriptionId }, data: { status: "CANCELED", canceledAt: new Date(), cancelReason: "chargeback" } });
    }
    return want - taken ? `${kind.toLowerCase()}:owed_${want - taken}` : kind.toLowerCase();
  });
}

/** Customer asks to stop renewing. Perks last until the paid month ends. */
export async function requestCancel(db: PrismaClient, customerId: string, cancelAtProcessor: (s: SiteSubscription) => Promise<void>, reason = "customer") {
  const s = await currentSubscription(db, customerId);
  if (!s) throw new SubscriptionError("not_found", "You don't have an active plan.", 404);
  await cancelAtProcessor(s);
  await db.siteSubscription.update({ where: { id: s.id }, data: { status: "CANCELED", canceledAt: new Date(), cancelReason: reason } });
  return s;
}

/** Subscriber XP and Sparks on top of a paid opening's base rewards. Idempotent per opening. */
export async function subscriberBonusForOpening(
  tx: Tx,
  shop: string,
  customerId: string,
  openingId: string,
  base: { xp: { xp: number } | null; sparks: number },
  award: { xp: (input: { shop: string; customerId: string; eventKey: string; kind: string; xp: number; source?: string }) => Promise<unknown> },
) {
  const tier = await activeTier(tx, customerId);
  if (!tier) return { xp: 0, sparks: 0 };
  const xp = base.xp ? Math.floor((base.xp.xp * tier.xpBonusPct) / 100) : 0;
  if (xp > 0) await award.xp({ shop, customerId, eventKey: `sub-xp:site-open:${openingId}`, kind: "subscriber_bonus", xp, source: openingId });
  let sparks = Math.floor((base.sparks * tier.sparksBonusPct) / 100);
  if (sparks > 0) {
    const eventKey = `sub-spark:site-open:${openingId}`;
    const existing = await tx.cardbitSparkTxn.findUnique({ where: { shop_eventKey: { shop, eventKey } } });
    if (existing) sparks = existing.delta;
    else {
      await tx.$executeRaw`INSERT INTO "CardbitSparkWallet" (shop, "customerId") VALUES (${shop}, ${customerId}) ON CONFLICT (shop, "customerId") DO NOTHING`;
      await tx.cardbitSparkTxn.create({ data: { shop, customerId, eventKey, kind: "award", delta: sparks, source: openingId, note: `Cardbit Club ${tier.name} +${tier.sparksBonusPct}%` } });
      await tx.cardbitSparkWallet.update({ where: { shop_customerId: { shop, customerId } }, data: { balance: { increment: sparks } } });
    }
  }
  return { xp, sparks };
}

/** What the plans page and store state show. */
export async function subscriptionView(db: Db, customerId: string | null) {
  const on = subscriptionsOn();
  if (!customerId) return { enabled: on, tiers: TIERS, current: null, perksTier: null };
  const [cur, perks] = await Promise.all([
    db.siteSubscription.findFirst({ where: { customerId }, orderBy: { createdAt: "desc" } }),
    activeTier(db, customerId),
  ]);
  return {
    enabled: on,
    tiers: TIERS,
    current: cur ? { tier: cur.tier, status: cur.status, currentPeriodEnd: cur.currentPeriodEnd?.toISOString() ?? null, canceledAt: cur.canceledAt?.toISOString() ?? null } : null,
    perksTier: perks?.id ?? null,
  };
}
