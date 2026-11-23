import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { PrismaClient } from "@prisma/client";
import {
  approvedGateways,
  cents,
  type Money,
} from "../lib/cardbit-topups.server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import {
  lockDesk,
  recordReferralPurchase,
  reviewReferral,
} from "./entries.server";

type Payment = {
  test: boolean;
  manualPaymentGateway: boolean;
  kind: string;
  status: string;
  gateway: string;
  amountSet: { shopMoney: Money };
  processedAt?: string;
};
export function verifiedMerchandise(
  order: {
    id: string;
    customer: { id: string } | null;
    test: boolean;
    cancelledAt: string | null;
    displayFinancialStatus: string;
    totalRefundedSet: { shopMoney: Money };
    transactions: Payment[];
  } | null,
  customerId: string,
  approved: Set<string>,
  since?: Date,
) {
  return (
    !!order &&
    order.test === false &&
    !order.cancelledAt &&
    order.displayFinancialStatus === "PAID" &&
    order.customer?.id === customerId &&
    cents(order.totalRefundedSet.shopMoney) === 0 &&
    order.transactions.length < 100 &&
    order.transactions.some(
      (t) =>
        (!since || Date.parse(t.processedAt ?? "") >= since.getTime()) &&
        t.test === false &&
        t.manualPaymentGateway === false &&
        t.status === "SUCCESS" &&
        ["SALE", "CAPTURE"].includes(t.kind) &&
        approved.has(t.gateway.toLowerCase()) &&
        cents(t.amountSet.shopMoney) > 0,
    )
  );
}
export async function checkPurchase(
  db: PrismaClient,
  admin: AdminApiContext,
  store: string,
  id: string,
  customerId: string | undefined,
) {
  if (
    store !== shop ||
    !customerId ||
    !/^gid:\/\/shopify\/Customer\/\d+$/.test(customerId)
  )
    return;
  const candidate = await db.cardbitGiveawayPerson.findUnique({
    where: { shop_customerId: { shop, customerId } },
    select: { referredBy: true, ageConfirmedAt: true },
  });
  if (!candidate) return;
  if (
    !candidate.referredBy &&
    !(await db.entrant.findFirst({
      where: {
        shopifyCustomerId: customerId,
        referredById: { not: null },
        campaign: { shop, status: "ACTIVE" },
      },
      select: { id: true },
    }))
  )
    return;
  const response = await admin.graphql(
    `#graphql
 query CardbitGiveawayPaidReferral($id:ID!){order(id:$id){id customer{id} test cancelledAt displayFinancialStatus totalRefundedSet{shopMoney{amount currencyCode}} transactions(first:100){processedAt test manualPaymentGateway kind status gateway amountSet{shopMoney{amount currencyCode}}}}}
 `,
    { variables: { id } },
  );
  const body = await response.json();
  if (!response.ok || ("errors" in body && body.errors))
    throw Error("Could not verify the referred purchase.");
  if (
    !verifiedMerchandise(
      body.data?.order,
      customerId,
      approvedGateways(),
      candidate.ageConfirmedAt,
    )
  )
    return;
  await db.$transaction(async (tx) => {
    await lockDesk(tx);
    const reversed = await tx.cardbitGiveawayAudit.findFirst({
      where: { shop, action: "order-reversed", detail: id },
    });
    if (!reversed) await recordReferralPurchase(tx, shop, customerId, id);
  });
}
export async function reverseReferralOrder(
  db: PrismaClient,
  store: string,
  id: string,
) {
  if (store !== shop) return;
  await db.$transaction(async (tx) => {
    await lockDesk(tx);
    if (!(await tx.cardbitGiveawayConfig.findUnique({ where: { shop } })))
      return;
    const seen = await tx.cardbitGiveawayAudit.findFirst({
      where: { shop, action: "order-reversed", detail: id },
    });
    if (seen) return;
    await tx.cardbitGiveawayAudit.create({
      data: {
        shop,
        actor: "payment-review",
        action: "order-reversed",
        detail: id,
      },
    });
    await reviewReferral(tx, id);
  });
}
