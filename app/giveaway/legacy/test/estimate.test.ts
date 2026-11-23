import { describe, expect, it } from "vitest";
import {
  estimateEntries,
  parseEstimateLines,
  toGid,
} from "../app/lib/entries/estimate";
import { purchaseRulesSchema } from "../app/lib/entries/rules";

const rules = purchaseRulesSchema.parse({
  base: { mode: "per_amount", entries: 1, amount: 1, basis: "subtotal" },
  productRules: [
    {
      name: "ETB bonus",
      mode: "per_unit",
      entries: 10,
      productIds: ["gid://shopify/Product/7"],
    },
  ],
});

describe("entry estimates", () => {
  it("scores a product page selection from cents", () => {
    const lines = parseEstimateLines([
      { productId: "7", variantId: "70", price: "4999", quantity: "2" },
    ]);
    // $99.98 at 1 per $1 = 99, plus 10 per unit = 20.
    expect(estimateEntries(rules, lines)).toBe(119);
  });

  it("takes /cart.js items and skips gift cards", () => {
    const lines = parseEstimateLines([
      { product_id: 1, variant_id: 11, quantity: 1, price: 2500 },
      {
        product_id: 2,
        variant_id: 22,
        quantity: 1,
        price: 5000,
        gift_card: true,
      },
    ]);
    expect(estimateEntries(rules, lines)).toBe(25);
  });

  it("ignores junk and returns 0 for an empty basket", () => {
    expect(parseEstimateLines("nope")).toEqual([]);
    expect(
      parseEstimateLines([{ quantity: 0, price: 100 }, { price: "abc" }, null]),
    ).toEqual([]);
    expect(estimateEntries(rules, [])).toBe(0);
  });

  it("normalizes ids to gids", () => {
    expect(toGid("Product", 7)).toBe("gid://shopify/Product/7");
    expect(toGid("Product", "gid://shopify/Product/7")).toBe(
      "gid://shopify/Product/7",
    );
    expect(toGid("Product", null)).toBe("");
  });
});
