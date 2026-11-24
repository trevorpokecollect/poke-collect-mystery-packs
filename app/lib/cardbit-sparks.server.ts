import type { Prisma, PrismaClient } from "@prisma/client";
import { isCardbit } from "./cardbit.server";
import { readBook } from "../workspace/book.server";
import { offer as currentOffer } from "../workspace/model";
import { SPARK_RATE_PERCENT, SPARK_TIERS, sparksForOpening } from "./cardbit-sparks";

type Tx = Prisma.TransactionClient;

/** Sparks stay off until Trevor approves them for customers (CARDBIT_SPARKS=on). */
export const sparksEnabled = (shop: string, env: NodeJS.ProcessEnv = process.env) =>
  isCardbit(shop, env) && env.CARDBIT_SPARKS === "on";

async function lockSparkWallet(tx: Tx, shop: string, customerId: string) {
  await tx.$executeRaw`INSERT INTO "CardbitSparkWallet" (shop, "customerId") VALUES (${shop}, ${customerId}) ON CONFLICT (shop, "customerId") DO NOTHING`;
  await tx.$queryRaw`SELECT "customerId" FROM "CardbitSparkWallet" WHERE shop=${shop} AND "customerId"=${customerId} FOR UPDATE`;
  return tx.cardbitSparkWallet.findUniqueOrThrow({ where: { shop_customerId: { shop, customerId } } });
}

/**
 * Award Sparks for a paid Cardbits opening, inside the opening's transaction.
 * Keyed by the opening's receipt, so a retry, replay or refresh never awards twice.
 * A pulled card without an active buyback offer counts as zero value.
 */
export async function awardPackSparks(
  tx: Tx,
  input: { shop: string; customerId: string; receiptKey: string; paidCardbits: number; orderId: string },
) {
  if (!sparksEnabled(input.shop)) return null;
  const eventKey = "spark:" + input.receiptKey;
  const existing = await tx.cardbitSparkTxn.findUnique({ where: { shop_eventKey: { shop: input.shop, eventKey } } });
  if (existing) return existing;
  const [book, pulls] = await Promise.all([
    readBook(tx),
    tx.pull.findMany({
      where: { shop: input.shop, orderId: input.orderId, customerId: input.customerId },
      select: { id: true, slot: { select: { card: { select: { variantId: true } } } } },
    }),
  ]);
  if (!pulls.length) return null;
  const value = pulls.reduce((sum, p) => {
    const ref = book.refs[book.variants[p.slot.card.variantId]];
    return sum + ((ref && currentOffer(ref, book.policy)) || 0);
  }, 0);
  const sparks = sparksForOpening(input.paidCardbits, value);
  if (sparks <= 0) return null;
  await lockSparkWallet(tx, input.shop, input.customerId);
  const row = await tx.cardbitSparkTxn.create({
    data: {
      shop: input.shop,
      customerId: input.customerId,
      eventKey,
      kind: "award",
      delta: sparks,
      source: input.receiptKey,
      note: `paid ${input.paidCardbits}, pulled value ${value}`,
    },
  });
  await tx.cardbitSparkWallet.update({
    where: { shop_customerId: { shop: input.shop, customerId: input.customerId } },
    data: { balance: { increment: sparks } },
  });
  return row;
}

/** Take back an award once, for a refunded or reversed opening. The balance never drops below zero. */
export async function reverseSparks(tx: Tx, shop: string, receiptKey: string, reason: string) {
  const award = await tx.cardbitSparkTxn.findUnique({ where: { shop_eventKey: { shop, eventKey: "spark:" + receiptKey } } });
  if (!award || award.delta <= 0) return null;
  const wallet = await lockSparkWallet(tx, shop, award.customerId);
  const key = "spark-reverse:" + receiptKey;
  const done = await tx.cardbitSparkTxn.findUnique({ where: { shop_eventKey: { shop, eventKey: key } } });
  if (done) return done;
  const delta = -Math.min(award.delta, wallet.balance);
  const row = await tx.cardbitSparkTxn.create({
    data: { shop, customerId: award.customerId, eventKey: key, kind: "reversal", delta, source: receiptKey, note: reason },
  });
  if (delta)
    await tx.cardbitSparkWallet.update({
      where: { shop_customerId: { shop, customerId: award.customerId } },
      data: { balance: { increment: delta } },
    });
  return row;
}

export async function sparksView(db: PrismaClient, shop: string, customerId: string) {
  const [wallet, history] = await Promise.all([
    db.cardbitSparkWallet.findUnique({ where: { shop_customerId: { shop, customerId } } }),
    db.cardbitSparkTxn.findMany({
      where: { shop, customerId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { kind: true, delta: true, createdAt: true },
    }),
  ]);
  return { enabled: true, balance: wallet?.balance ?? 0, history, ratePercent: SPARK_RATE_PERCENT, tiers: SPARK_TIERS };
}
