import { describe, expect, it } from "vitest";
import {
  approvedGateways,
  topups,
  verifiedPaidTopup,
  type PaidOrder,
} from "./cardbit-topups.server";
const money = (cents: number) => ({
  shopMoney: { amount: (cents / 100).toFixed(2), currencyCode: "USD" },
});
const gateways = approvedGateways("example_external");
function order(index: number, quantity = 1): PaidOrder {
  const tier = topups[index],
    total = tier.amount * quantity;
  return {
    id: "gid://shopify/Order/1",
    test: false,
    cancelledAt: null,
    displayFinancialStatus: "PAID",
    customer: { id: "gid://shopify/Customer/2" },
    totalPriceSet: money(total),
    totalRefundedSet: money(0),
    lineItems: {
      pageInfo: { hasNextPage: false },
      nodes: [
        {
          variant: { id: "gid://shopify/ProductVariant/" + tier.variant },
          quantity,
          currentQuantity: quantity,
          originalUnitPriceSet: money(tier.amount),
          discountAllocations: [],
        },
      ],
    },
    transactions: [
      {
        test: false,
        manualPaymentGateway: false,
        kind: "SALE",
        status: "SUCCESS",
        gateway: "example_external",
        amountSet: money(total),
      },
    ],
  };
}
describe("Cardbit paid top-ups", () => {
  it.each([
    [0, 1000, 0],
    [1, 5000, 0],
    [2, 10000, 500],
    [3, 50000, 5000],
  ])("credits denomination %i", (i, paid, bonus) => {
    expect(verifiedPaidTopup(order(i), gateways)).toMatchObject({
      amount: paid,
      paidCents: paid,
      bonus,
    });
  });
  it("calculates bonuses per unit, including mixed packages, and excludes other merchandise and tax", () => {
    const o = order(1, 2);
    o.lineItems.nodes.push(...order(2, 2).lineItems.nodes);
    o.lineItems.nodes.push({
      ...order(0).lineItems.nodes[0],
      variant: { id: "gid://shopify/ProductVariant/999" },
    });
    o.totalPriceSet = money(32900);
    o.transactions[0].amountSet = money(32900);
    expect(verifiedPaidTopup(o, gateways)).toMatchObject({
      paidCents: 30000,
      bonus: 1000,
    });
    expect(verifiedPaidTopup(order(1, 2), gateways)).toMatchObject({
      paidCents: 10000,
      bonus: 0,
    });
  });
  it.each([
    (o: PaidOrder) => {
      o.test = true;
    },
    (o: PaidOrder) => {
      o.transactions[0].test = true;
    },
    (o: PaidOrder) => {
      o.customer = null;
    },
    (o: PaidOrder) => {
      o.cancelledAt = "2026-11-23";
    },
    (o: PaidOrder) => {
      o.displayFinancialStatus = "AUTHORIZED";
    },
    (o: PaidOrder) => {
      o.transactions[0].kind = "AUTHORIZATION";
    },
    (o: PaidOrder) => {
      o.transactions[0].status = "FAILURE";
    },
    (o: PaidOrder) => {
      o.transactions[0].manualPaymentGateway = true;
    },
    (o: PaidOrder) => {
      o.transactions[0].gateway = "gift_card";
    },
    (o: PaidOrder) => {
      o.transactions[0].amountSet = money(1);
    },
    (o: PaidOrder) => {
      o.totalRefundedSet = money(1);
    },
    (o: PaidOrder) => {
      o.lineItems.nodes[0].discountAllocations = [
        { allocatedAmountSet: money(1) },
      ];
    },
    (o: PaidOrder) => {
      o.lineItems.nodes[0].currentQuantity = 0;
    },
    (o: PaidOrder) => {
      o.lineItems.pageInfo.hasNextPage = true;
    },
    (o: PaidOrder) => {
      o.lineItems.nodes[0].originalUnitPriceSet = money(1);
    },
    (o: PaidOrder) => {
      o.totalPriceSet.shopMoney.currencyCode = "CAD";
    },
    (o: PaidOrder) => {
      o.lineItems.nodes[0].variant = null;
    },
  ])("rejects incomplete or ineligible payment evidence %#", (mutate) => {
    const o = order(3);
    mutate(o);
    expect(verifiedPaidTopup(o, gateways)).toBeNull();
  });
  it("requires an approved external processor for every captured cent", () => {
    const o = order(2);
    expect(verifiedPaidTopup(o, new Set())).toBeNull();
    o.transactions[0].amountSet = money(9000);
    o.transactions.push({
      ...o.transactions[0],
      gateway: "shopify_store_credit",
      amountSet: money(1000),
    });
    expect(
      verifiedPaidTopup(
        o,
        approvedGateways(
          "example_external,shopify_store_credit,bogus,manual,gift_card",
        ),
      ),
    ).toBeNull();
  });
});
