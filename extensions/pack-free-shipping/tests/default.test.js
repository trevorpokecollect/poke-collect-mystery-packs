import {describe, expect, it} from "vitest";
import {cartDeliveryOptionsDiscountsGenerateRun, packCount, readConfig} from "../src/cart_delivery_options_discounts_generate_run";
import {cartLinesDiscountsGenerateRun} from "../src/cart_lines_discounts_generate_run";

const pack = (quantity, productType = "Mystery Pack") => ({quantity, merchandise: {product: {productType}}});
const input = (lines, config, classes = ["SHIPPING"]) => ({
  cart: {lines, deliveryGroups: [{id: "gid://shopify/CartDeliveryGroup/1"}]},
  discount: {discountClasses: classes, metafield: config ? {jsonValue: config} : null},
});

describe("free shipping on mystery packs", () => {
  it("is free with 5 or more packs", () => {
    const result = cartDeliveryOptionsDiscountsGenerateRun(input([pack(3), pack(2)]));
    expect(result.operations).toHaveLength(1);
    const candidate = result.operations[0].deliveryDiscountsAdd.candidates[0];
    expect(candidate.value).toEqual({percentage: {value: 100}});
    expect(candidate.targets).toEqual([{deliveryGroup: {id: "gid://shopify/CartDeliveryGroup/1"}}]);
  });

  it("charges shipping with 4 packs", () => {
    expect(cartDeliveryOptionsDiscountsGenerateRun(input([pack(4)])).operations).toEqual([]);
  });

  it("only counts mystery packs, not other items", () => {
    const lines = [pack(4), pack(10, "Pokemon Single"), {quantity: 3, merchandise: {}}];
    expect(packCount(input(lines), "Mystery Pack")).toBe(4);
    expect(cartDeliveryOptionsDiscountsGenerateRun(input(lines)).operations).toEqual([]);
  });

  it("uses the configured threshold and product type", () => {
    expect(readConfig(input([], {threshold: 3, productType: "Booster"}))).toEqual({threshold: 3, productType: "Booster"});
    expect(cartDeliveryOptionsDiscountsGenerateRun(input([pack(3)], {threshold: 3})).operations).toHaveLength(1);
    expect(readConfig(input([], {threshold: "nope"})).threshold).toBe(5);
  });

  it("does nothing unless the discount is a shipping discount", () => {
    expect(cartDeliveryOptionsDiscountsGenerateRun(input([pack(9)], null, ["ORDER"])).operations).toEqual([]);
  });

  it("never discounts products or the order", () => {
    expect(cartLinesDiscountsGenerateRun({discount: {discountClasses: ["ORDER", "PRODUCT"]}})).toEqual({operations: []});
  });
});
