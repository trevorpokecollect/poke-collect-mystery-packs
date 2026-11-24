import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { newToken } from "./fairness.server";
import { sparkPrice } from "./cardbit-sparks";
import { sparksEnabled } from "./cardbit-sparks.server";

/**
 * Spark Shop: cheap singles bought with Sparks. A Spark Shop pool is a launched series whose build
 * rules set cardbitSparkShop=true; each slot is one physical copy, reserved once like any pool.
 * The price comes from the card's value in Cardbits (SPARK_TIERS). Retail is never returned.
 */
export const sparkShopRules = { path: ["cardbitSparkShop"], equals: true };
export class SparkShopError extends Error {}

const valueCardbits = (marketValue: unknown) => Math.round(Number(marketValue) * 100);

export async function sparkShopView(db: PrismaClient, shop: string) {
  const series = await db.series.findMany({
    where: { shop, status: "LIVE", staffTest: false, buildRules: sparkShopRules },
    select: {
      cards: {
        select: {
          id: true,
          title: true,
          imageUrl: true,
          marketValue: true,
          _count: { select: { slots: { where: { claimed: false, voided: false } } } },
        },
      },
    },
  });
  return series
    .flatMap((s) => s.cards)
    .map((c) => ({ c, price: sparkPrice(valueCardbits(c.marketValue)) }))
    .filter(({ c, price }) => price && c._count.slots > 0)
    .map(({ c, price }) => ({
      cardId: c.id,
      title: c.title,
      imageUrl: c.imageUrl,
      tier: price!.tier,
      sparks: price!.sparks,
      remaining: c._count.slots,
    }))
    .sort((a, b) => a.sparks - b.sparks || a.title.localeCompare(b.title));
}

/**
 * Buy one copy with Sparks. requestId makes it idempotent: a retry returns the first result and a
 * reused requestId for a different card is refused. The copy goes into My Vault.
 */
export async function buySparkShopCard(
  db: PrismaClient,
  shop: string,
  customerId: string,
  input: { cardId: unknown; requestId: unknown; sparks: unknown },
) {
  if (!sparksEnabled(shop)) throw new SparkShopError("The Spark Shop is not open yet.");
  if (
    typeof input.cardId !== "string" ||
    input.cardId.length > 64 ||
    typeof input.requestId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(input.requestId) ||
    !Number.isSafeInteger(input.sparks)
  )
    throw new SparkShopError("Review the card again.");
  const cardId = input.cardId, sparks = input.sparks as number;
  const eventKey = "spark-buy:" + customerId + "/" + input.requestId;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "CardbitSparkWallet" (shop, "customerId") VALUES (${shop}, ${customerId}) ON CONFLICT (shop, "customerId") DO NOTHING`;
    await tx.$queryRaw`SELECT "customerId" FROM "CardbitSparkWallet" WHERE shop=${shop} AND "customerId"=${customerId} FOR UPDATE`;
    const previous = await tx.cardbitSparkTxn.findUnique({ where: { shop_eventKey: { shop, eventKey } } });
    if (previous) {
      if (previous.source !== cardId) throw new SparkShopError("This confirmation already belongs to another card.");
      return { txnId: previous.id, pullId: previous.note!, replay: true };
    }
    const card = await tx.card.findFirst({
      where: { id: cardId, series: { shop, status: "LIVE", staffTest: false, buildRules: sparkShopRules } },
      select: { id: true, title: true, marketValue: true, seriesId: true },
    });
    if (!card) throw new SparkShopError("This card is no longer in the Spark Shop.");
    // Serialize claims on this pool so two buyers can never take the same copy.
    await tx.$queryRaw`SELECT id FROM "Series" WHERE id=${card.seriesId} FOR UPDATE`;
    const price = sparkPrice(valueCardbits(card.marketValue));
    if (!price || price.sparks !== sparks) throw new SparkShopError("The Sparks price changed. Review it again.");
    const wallet = await tx.cardbitSparkWallet.findUniqueOrThrow({ where: { shop_customerId: { shop, customerId } } });
    if (wallet.balance < sparks) throw new SparkShopError("You don't have enough Sparks.");
    const slot = await tx.slot.findFirst({
      where: { seriesId: card.seriesId, cardId: card.id, claimed: false, voided: false },
      orderBy: { position: "asc" },
    });
    if (!slot) throw new SparkShopError("This card just sold out.");
    await tx.slot.update({ where: { id: slot.id }, data: { claimed: true } });
    const orderId = "cardbit-spark:" + randomUUID(), now = new Date();
    await tx.packOrder.create({
      data: {
        orderId, shop, orderName: "Spark Shop", customerId, openToken: newToken(), vault: true,
        held: true, finalized: true, packLinesFulfilledAt: now, pullsNotedAt: now,
      },
    });
    const pull = await tx.pull.create({
      data: {
        shop, seriesId: card.seriesId, slotId: slot.id, orderId, orderName: "Spark Shop",
        lineItemId: orderId + "/1", packIndex: 0, cardIndex: 0, customerId, status: "REVEALED", revealedAt: now,
      },
    });
    const txn = await tx.cardbitSparkTxn.create({
      data: { shop, customerId, eventKey, kind: "purchase", delta: -sparks, source: card.id, note: pull.id },
    });
    await tx.cardbitSparkWallet.update({
      where: { shop_customerId: { shop, customerId } },
      data: { balance: { decrement: sparks } },
    });
    const left = await tx.slot.count({ where: { seriesId: card.seriesId, claimed: false, voided: false } });
    if (left === 0) await tx.series.update({ where: { id: card.seriesId }, data: { status: "CLOSED", closedAt: now } });
    return { txnId: txn.id, pullId: pull.id, replay: false };
  });
}
