import { describe, expect, test } from "vitest";
import { cartDeliveryOptionsTransformRun } from "../src/cart_delivery_options_transform_run.js";

const input = ({ customer = true, types = ["Pokemon Single"] } = {}) => ({
  cart: {
    buyerIdentity: customer ? { isAuthenticated: true, customer: { id: "gid://shopify/Customer/1" } } : null,
    lines: types.map((t) => ({ merchandise: { product: { productType: t } } })),
    deliveryGroups: [
      { deliveryOptions: [{ handle: "vault", title: "Keep In My Vault (Don't Ship Now)" }, { handle: "std", title: "Standard" }] },
    ],
  },
  deliveryCustomization: { metafield: null },
});

describe("Keep In My Vault rate", () => {
  test("logged-in, singles only: offered, moved to the end", () => {
    expect(cartDeliveryOptionsTransformRun(input()).operations).toEqual([{ deliveryOptionMove: { deliveryOptionHandle: "vault", index: 1 } }]);
  });
  test("hidden for guests", () => {
    expect(cartDeliveryOptionsTransformRun(input({ customer: false })).operations).toEqual([{ deliveryOptionHide: { deliveryOptionHandle: "vault" } }]);
  });
  test("hidden when the cart has anything but singles", () => {
    expect(cartDeliveryOptionsTransformRun(input({ types: ["Pokemon Single", "Sealed"] })).operations).toEqual([{ deliveryOptionHide: { deliveryOptionHandle: "vault" } }]);
  });
});
