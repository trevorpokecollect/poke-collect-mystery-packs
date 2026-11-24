// Processor-neutral Cardbits top-up payments.
// A payment processor adapter (Stripe today; Authorize.net or another later) verifies a payment
// with its own API, then hands a VerifiedTopupPayment here. This module is the only place that
// turns a processor payment into Cardbits, so every processor shares the same ledger rules:
// one credit per payment, paid and bonus Cardbits as separate entries, and reversals that
// freeze the wallet and take the Cardbits back.
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { topups } from "../cardbit-topups.server";
import { recordFunding, reviewFunding } from "../cardbits.server";

export type TopupProvider = "stripe";
export type TopupPackage = (typeof topups)[number];

export type VerifiedTopupPayment = {
  provider: TopupProvider;
  /** The processor's stable id for the captured payment (Stripe: the PaymentIntent id). */
  paymentId: string;
  customerId: string;
  /** Shopify variant id of the package, digits only, as listed in cardbit-topups.server.ts. */
  variant: string;
  /** USD cents captured for this package. */
  paidCents: number;
};

const CUSTOMER = /^gid:\/\/shopify\/Customer\/\d+$/;
const PAYMENT_ID = /^[A-Za-z0-9_-]{6,128}$/;

export const topupPackage = (variant: string) =>
  topups.find((t) => t.variant === variant) ?? null;

/** The ledger key for a processor payment. Stable across retries and duplicate events. */
export const fundingId = (provider: TopupProvider, paymentId: string) =>
  `${provider}:${paymentId}`;

/**
 * Credits a verified payment exactly once. Returns null (and credits nothing) when the payment
 * does not match a top-up package exactly.
 */
export async function creditTopupPayment(
  db: PrismaClient,
  shop: string,
  payment: VerifiedTopupPayment,
) {
  const tier = topupPackage(payment.variant);
  if (
    !tier ||
    !CUSTOMER.test(payment.customerId) ||
    !PAYMENT_ID.test(payment.paymentId) ||
    payment.paidCents !== tier.amount
  )
    return null;
  // 100 Cardbits = US$1, so the package's cents are its purchased Cardbits.
  return recordFunding(db, shop, {
    id: fundingId(payment.provider, payment.paymentId),
    customerId: payment.customerId,
    amount: tier.amount,
    bonus: tier.bonus,
    paidCents: payment.paidCents,
  });
}

/**
 * A refund or dispute opened on a funded payment: freeze the wallet for review.
 * Idempotent; safe to call for payments that were never credited.
 */
export async function holdTopupPayment(
  db: PrismaClient,
  shop: string,
  provider: TopupProvider,
  paymentId: string,
) {
  await reviewFunding(db, shop, fundingId(provider, paymentId));
}

/**
 * A payment that was fully refunded or lost a dispute: freeze the wallet and take back every
 * Cardbit the payment created, purchased and bonus, as separately identifiable entries.
 * The balance never goes below zero (the ledger forbids it): Cardbits already spent are
 * recorded on the reversal entry as owed, and the wallet stays held while staff reconcile
 * the cards bought with them. Returns the Cardbits taken back plus owed (0 on a replay).
 */
export async function reverseTopupPayment(
  db: PrismaClient,
  shop: string,
  provider: TopupProvider,
  paymentId: string,
  reason: string,
) {
  const id = fundingId(provider, paymentId);
  await reviewFunding(db, shop, id);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${shop + "/" + id},0))::text`;
    const credited = await tx.cardbitReceipt.findMany({
      where: {
        shop,
        eventKey: { in: ["fund:" + id, "bonus:" + id] },
      },
    });
    if (!credited.length) return 0;
    const customerId = credited[0].customerId;
    await tx.cardbitWallet.upsert({
      where: { shop_customerId: { shop, customerId } },
      create: { shop, customerId },
      update: {},
    });
    await tx.$queryRaw`SELECT "customerId" FROM "CardbitWallet" WHERE shop=${shop} AND "customerId"=${customerId} FOR UPDATE`;
    let taken = 0;
    for (const entry of credited) {
      const bonus = entry.eventKey.startsWith("bonus:");
      const eventKey = (bonus ? "reverse-bonus:" : "reverse:") + id;
      if (await tx.cardbitReceipt.findUnique({ where: { shop_eventKey: { shop, eventKey } } }))
        continue;
      const { balance } = await tx.cardbitWallet.findUniqueOrThrow({
        where: { shop_customerId: { shop, customerId } },
      });
      const takeBack = Math.min(entry.delta, Math.max(balance, 0));
      const owed = entry.delta - takeBack;
      const wallet = await tx.cardbitWallet.update({
        where: { shop_customerId: { shop, customerId } },
        data: { balance: { decrement: takeBack }, held: true },
      });
      await tx.cardbitReceipt.create({
        data: {
          shop,
          customerId,
          eventKey,
          fingerprint: createHash("sha256").update(JSON.stringify([id, entry.delta, reason])).digest("hex"),
          kind: bonus ? "topup-bonus-reversal" : "topup-reversal",
          reason: (owed ? `${reason}; ${owed} Cardbits already spent and owed` : reason).slice(0, 200),
          delta: -takeBack,
          balanceAfter: wallet.balance,
          source: provider,
        },
      });
      taken += entry.delta;
    }
    return taken;
  });
}
