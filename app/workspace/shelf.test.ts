import { describe, it, expect } from "vitest";
import { lookKey, faceKey, shelfAddress, type Intake } from "./shelf.server";
import {
  eligibility,
  labelOptions,
  type OrderLine,
  type OrderHeader,
  type ParcelHeader,
} from "./shipping-shopify.server";
import { matchingPulls, exactFulfillment } from "./fulfillment.server";
import { parcelLines } from "../lib/cardbit-shipping.server";
const sample: Intake = {
  eventKey: "receipt:1",
  variantId: "gid://shopify/ProductVariant/1",
  quantity: 1,
  title: "Pikachu",
  condition: "NM",
  game: "pokemon",
  setName: "Example",
  name: "Pikachu",
  finish: "Holofoil",
  number: "025/100",
  language: "English",
};
const order = {
  test: false,
  cancelledAt: null,
  displayFinancialStatus: "PAID",
  shippingLine: { title: "Ground" },
} as OrderHeader;
const parcel: ParcelHeader = {
  id: "fo",
  status: "OPEN",
  supportedActions: [{ action: "CREATE_FULFILLMENT" }],
  assignedLocation: {
    name: "Store",
    location: { id: "location", isFulfillmentService: false },
  },
  deliveryMethod: { methodType: "SHIPPING" },
};
const line = {
  lineItem: {
    variant: null,
    title: "Vault Card: Pikachu",
    customAttributes: [],
  },
} as unknown as OrderLine;
const pull = (id: string, v: string) => ({
  id,
  slotId: id,
  series: { storePurchase: true },
  slot: { card: { variantId: v, title: "Pikachu" } },
});
describe("physical identification and shipping", () => {
  it("groups look-alikes regardless of the product variant, condition, language, or finish", () => {
    expect(lookKey(sample)).toBe(
      lookKey({
        ...sample,
        number: "25",
        variantId: "other",
        condition: "LP",
        language: "Japanese",
        game: "pokemon-japan",
        finish: "Reverse Holofoil",
      }),
    );
    expect(faceKey("Flabébé")).toBe(faceKey("Flabebe"));
    expect(shelfAddress(237)).toEqual({ shelf: 3, box: 12, slot: 237 });
    expect(() => lookKey({ ...sample, number: "" })).toThrow();
  });
  it.each([
    { test: true },
    { cancelledAt: "now" },
    { displayFinancialStatus: "PENDING" },
    { displayFinancialStatus: "REFUNDED" },
    { shippingLine: { title: "Keep In My Vault (Don't Ship Now)" } },
  ])("rejects ineligible orders", (change) => {
    expect(eligibility({ ...order, ...change }, parcel)).toBeTruthy();
  });
  it("only fulfills a merchant-managed shipping location", () => {
    expect(eligibility(order, parcel)).toBe("");
    expect(eligibility(order, { ...parcel, status: "ON_HOLD" })).toBeTruthy();
    expect(
      eligibility(order, {
        ...parcel,
        deliveryMethod: { methodType: "PICK_UP" },
      }),
    ).toBeTruthy();
    expect(
      eligibility(order, {
        ...parcel,
        assignedLocation: {
          name: "3PL",
          location: { id: "3pl", isFulfillmentService: true },
        },
      }),
    ).toBeTruthy();
  });
  it("uses a printing reference for look-alike titles and rejects ambiguous legacy lines", () => {
    const pulls = [pull("one", "v1"), pull("two", "v2")];
    expect(() => matchingPulls(line, pulls)).toThrow(/share/);
    const shipping = parcelLines(pulls, "USD", true)[0];
    const customAttributes =
      "customAttributes" in shipping ? shipping.customAttributes! : [];
    expect(
      matchingPulls(
        { ...line, lineItem: { ...line.lineItem, customAttributes } },
        pulls,
      ),
    ).toEqual([pulls[0]]);
  });
  it("requires identical order-line quantities to reconcile a physical shipment", () => {
    const expected = [{ id: "fo-line", lineItemId: "line", quantity: 2 }];
    expect(
      exactFulfillment(expected, [{ quantity: 2, lineItem: { id: "line" } }]),
    ).toBe(true);
    expect(
      exactFulfillment(expected, [{ quantity: 1, lineItem: { id: "line" } }]),
    ).toBe(false);
    expect(
      exactFulfillment(expected, [{ quantity: 2, lineItem: { id: "other" } }]),
    ).toBe(false);
  });
  it("uses the packed weight and a future ship date when purchasing postage", () => {
    const input = {
      shippingDatetime: new Date(Date.now() + 86400000).toISOString(),
      ounces: 3.2,
    };
    expect(labelOptions("fo", input)).toMatchObject({
      fulfillmentOrderId: "fo",
      totalWeight: { unit: "OUNCES", value: 3.2 },
    });
    expect(() => labelOptions("fo", { ...input, ounces: 0 })).toThrow();
    expect(() =>
      labelOptions("fo", { ...input, carrierCode: "ups" }),
    ).toThrow();
  });
});
