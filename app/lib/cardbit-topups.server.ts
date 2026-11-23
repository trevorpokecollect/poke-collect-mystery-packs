// These four Shopify variants belong to the Cardbit store. Prices are USD cents.
export const topups = [
  { variant: "50950076727458", amount: 1000, bonus: 0 },
  { variant: "50950076760226", amount: 5000, bonus: 0 },
  { variant: "50950076792994", amount: 10000, bonus: 500 },
  { variant: "50950076825762", amount: 50000, bonus: 5000 },
] as const;

const byId = new Map(
  topups.map((t) => ["gid://shopify/ProductVariant/" + t.variant, t]),
);
export const isTopupVariant = (id: string) => byId.has(id);
export function approvedGateways(
  value = process.env.CARDBIT_APPROVED_GATEWAYS || "",
) {
  return new Set(
    value
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(
        (s) =>
          s &&
          !/manual|bogus|test|gift[ _-]?card|store[ _-]?credit|cash[ _-]?(on|payment)|bank[ _-]?(deposit|transfer)|money[ _-]?order|draft[ _-]?order/.test(
            s,
          ),
      ),
  );
}

export type Money = { amount: string; currencyCode: string };
type Price = { shopMoney: Money };
export function cents(money?: Money): number {
  if (
    !money ||
    money.currencyCode !== "USD" ||
    !/^\d+(\.\d{1,2})?$/.test(money.amount)
  )
    return -1;
  const [whole, fraction = ""] = money.amount.split(".");
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(n) ? n : -1;
}
export type PaidOrder = {
  id: string;
  test: boolean;
  cancelledAt: string | null;
  displayFinancialStatus: string;
  customer: { id: string } | null;
  totalPriceSet: Price;
  totalRefundedSet: Price;
  lineItems: {
    pageInfo: { hasNextPage: boolean };
    nodes: {
      variant: { id: string } | null;
      quantity: number;
      currentQuantity: number;
      originalUnitPriceSet: Price;
      discountAllocations: { allocatedAmountSet: Price }[];
    }[];
  };
  transactions: {
    test: boolean;
    manualPaymentGateway: boolean;
    status: string;
    kind: string;
    gateway: string;
    amountSet: Price;
  }[];
};

// A top-up earns its advertised bonus per unit. Other merchandise, tax and shipping never earn it.
export function verifiedPaidTopup(
  order: PaidOrder | null,
  approved: Set<string>,
) {
  if (
    !order ||
    order.test !== false ||
    order.cancelledAt ||
    order.displayFinancialStatus !== "PAID" ||
    !order.customer ||
    !/^gid:\/\/shopify\/Customer\/\d+$/.test(order.customer.id) ||
    !approved.size ||
    order.lineItems.pageInfo.hasNextPage ||
    order.transactions.length >= 100 ||
    cents(order.totalRefundedSet?.shopMoney) !== 0
  )
    return null;
  let amount = 0,
    bonus = 0;
  for (const line of order.lineItems.nodes) {
    const tier = line.variant && byId.get(line.variant.id);
    if (!tier) continue;
    if (
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      line.currentQuantity !== line.quantity ||
      cents(line.originalUnitPriceSet.shopMoney) !== tier.amount ||
      line.discountAllocations.some(
        (d) => cents(d.allocatedAmountSet.shopMoney) !== 0,
      )
    )
      return null;
    amount += tier.amount * line.quantity;
    bonus += tier.bonus * line.quantity;
  }
  const total = cents(order.totalPriceSet.shopMoney);
  const captures = order.transactions.filter(
    (t) => t.status === "SUCCESS" && ["SALE", "CAPTURE"].includes(t.kind),
  );
  if (
    !amount ||
    amount + bonus > 2_147_483_647 ||
    amount > total ||
    !captures.length ||
    captures.some(
      (t) =>
        t.test !== false ||
        t.manualPaymentGateway !== false ||
        !approved.has(t.gateway.toLowerCase()) ||
        cents(t.amountSet.shopMoney) <= 0,
    ) ||
    captures.reduce((n, t) => n + cents(t.amountSet.shopMoney), 0) !== total
  )
    return null;
  return {
    id: order.id,
    customerId: order.customer.id,
    amount,
    bonus,
    paidCents: amount,
  };
}
