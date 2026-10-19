import { describe, expect, it } from "vitest";
import { paidWithStoreCredit } from "./paid-order.server";

describe("store credit on pack orders", () => {
  it("spots store credit among the order's payment gateways", () => {
    expect(paidWithStoreCredit({ payment_gateway_names: ["shopify_payments", "shopify_store_credit"] })).toBe(true);
    expect(paidWithStoreCredit({ payment_gateway_names: ["Store Credit"] })).toBe(true);
    expect(paidWithStoreCredit({ payment_gateway_names: ["shopify_payments", "gift_card"] })).toBe(false);
    expect(paidWithStoreCredit({})).toBe(false);
  });
});
