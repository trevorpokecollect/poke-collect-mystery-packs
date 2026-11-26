// Monthly plan emails: welcome/renewal receipt (also the auto-renewal acknowledgment state laws expect)
// and renewal-canceled notice. Sent once each through the outbox's dedupe key; a failure never breaks
// the webhook or the customer's cancel.
import type { PrismaClient } from "@prisma/client";
import { balanceOf } from "../core/ledger.server";
import { mailerFromEnv } from "../email/mailer.server";
import { sendEmail, type EmailDeps } from "../email/outbox.server";
import { tierById } from "./subscriptions.server";

const depsFor = (db: PrismaClient, env: NodeJS.ProcessEnv = process.env): EmailDeps => ({ db, mailer: mailerFromEnv(env), env });

/** After creditSubscriptionPayment returned "credited" for this processor payment id. */
export async function sendPlanPaymentEmail(db: PrismaClient, paymentId: string, deps: EmailDeps = depsFor(db)) {
  try {
    const p = await db.siteSubscriptionPayment.findUnique({ where: { paymentId }, include: { subscription: true } });
    if (!p) return;
    const [customer, earlier, balance] = await Promise.all([
      db.siteCustomer.findUnique({ where: { id: p.customerId }, select: { email: true } }),
      db.siteSubscriptionPayment.count({ where: { subscriptionId: p.subscriptionId, createdAt: { lt: p.createdAt } } }),
      balanceOf(db, p.customerId),
    ]);
    if (!customer?.email) return;
    const tier = tierById(p.subscription.tier);
    await sendEmail(deps, "plan_payment", customer.email, {
      paymentId: p.paymentId,
      first: earlier === 0,
      tierName: tier?.name ?? p.subscription.tier,
      paidCents: p.cents,
      bits: p.paidBits,
      bonusBits: p.bonusBits,
      balanceBits: balance,
      renewsAt: p.periodEnd.toISOString(),
    }, p.id);
  } catch (e) {
    console.error("[site] plan payment email failed", paymentId, e);
  }
}

/** After a subscription moved to CANCELED (customer, break, staff or processor). */
export async function sendPlanCanceledEmail(db: PrismaClient, subscriptionId: string, deps: EmailDeps = depsFor(db)) {
  try {
    const s = await db.siteSubscription.findUnique({ where: { id: subscriptionId } });
    if (!s || s.status !== "CANCELED" || s.cancelReason === "chargeback") return;
    const customer = await db.siteCustomer.findUnique({ where: { id: s.customerId }, select: { email: true } });
    if (!customer?.email) return;
    const byBreak = /^(cool_off|self_exclusion|break_)/.test(s.cancelReason ?? "");
    await sendEmail(deps, "plan_canceled", customer.email, {
      tierName: tierById(s.tier)?.name ?? s.tier,
      perksUntil: s.currentPeriodEnd?.toISOString() ?? null,
      byBreak,
    }, s.id);
  } catch (e) {
    console.error("[site] plan canceled email failed", subscriptionId, e);
  }
}
