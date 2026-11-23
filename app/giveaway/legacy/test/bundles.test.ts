import { describe, expect, it, vi } from "vitest";

vi.mock("../app/shopify.server", () => ({ unauthenticated: {} }));
import {
  bundleTitle,
  bundleValue,
  parseBundle,
  publicItems,
} from "../app/lib/bundles";
import { prizeOrderInput } from "../app/lib/prize-order.server";

const P = (n: number) => `gid://shopify/Product/${n}`;

describe("bundles", () => {
  it("names bundles with 3x counts", () => {
    expect(bundleTitle([{ title: "Booster Pack", quantity: 3 }])).toBe(
      "3x Booster Pack",
    );
    expect(
      bundleTitle([
        { title: "ETB", quantity: 1 },
        { title: "Booster Pack", quantity: 2 },
      ]),
    ).toBe("ETB + 2x Booster Pack");
    expect(
      bundleValue([
        { value: 4.99, quantity: 3 },
        { value: 50, quantity: 1 },
      ]),
    ).toBe(64.97);
  });

  it("cleans the editor's parts", () => {
    expect(
      parseBundle([{ productId: P(1), title: "A", quantity: 1 }]),
    ).toBeNull();
    expect(parseBundle([{ productId: "nope", quantity: 3 }])).toBeNull();
    expect(
      parseBundle([
        { productId: P(1), title: "A", quantity: 2 },
        { productId: P(1), title: "A", quantity: 2 },
        { productId: P(2), title: "B", quantity: 99 },
      ]),
    ).toEqual([
      { productId: P(1), title: "A", imageUrl: null, quantity: 4 },
      { productId: P(2), title: "B", imageUrl: null, quantity: 10 },
    ]);
  });

  it("shows pictures and counts, never values", () => {
    expect(
      publicItems([
        { title: "A", imageUrl: "x", quantity: 3, productHandle: "a" },
      ]),
    ).toEqual([{ title: "A", imageUrl: "x", quantity: 3, url: "/products/a" }]);
  });

  it("puts every bundle line in the $0 order", () => {
    const input = prizeOrderInput({
      email: "a@b.c",
      claim: {
        name: "Ash K",
        address1: "1 Rd",
        address2: "",
        city: "X",
        province: "TX",
        zip: "75001",
        country: "US",
        phone: "5551234567",
      },
      variantId: "v1",
      lines: [
        { variantId: "v1", quantity: 3 },
        { variantId: "v2", quantity: 1 },
      ],
      prizeTitle: "3x A + B",
      giveawayTitle: "Daily",
      drawDate: "2026-10-21",
      currencyCode: "USD",
    });
    expect(input.lineItems.map((l) => [l.variantId, l.quantity])).toEqual([
      ["v1", 3],
      ["v2", 1],
    ]);
  });
});
