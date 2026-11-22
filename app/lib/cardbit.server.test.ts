import { describe, expect, it } from "vitest";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import {
  CARDBIT_SHOP,
  isCardbit,
  samplePack,
  packFrequencies,
} from "./cardbit.server";
import { cardbitsConfig, verifiedFunding } from "./cardbits.server";
import {
  parcelAddress,
  parcelLines,
  quoteParcel,
} from "./cardbit-shipping.server";
import { paidParcelMatches } from "./vault.server";

const qa = "gid://shopify/Customer/11";
const variant = "gid://shopify/ProductVariant/22";
const env = {
  CARDBIT_STOREFRONT_SHOP: CARDBIT_SHOP,
  CARDBIT_COMMERCE_MODE: "staging",
  CARDBIT_QA_CUSTOMERS: qa,
  CARDBIT_TEST_GATEWAY: "test-gateway",
  CARDBIT_TEST_TOPUPS: JSON.stringify({ [variant]: 500 }),
};
const config = cardbitsConfig(CARDBIT_SHOP, env)!;
const usd = (amount: string) => ({
  shopMoney: { amount, currencyCode: "USD" },
});
const captured = () => ({
  id: "gid://shopify/Order/33",
  test: true,
  cancelledAt: null,
  displayFinancialStatus: "PAID",
  customer: { id: qa },
  totalPriceSet: usd("10.00"),
  lineItems: {
    nodes: [{ quantity: 2, variant: { id: variant } }],
    pageInfo: { hasNextPage: false },
  },
  transactions: [
    {
      kind: "SALE",
      test: true,
      gateway: "test-gateway",
      status: "SUCCESS",
      amountSet: usd("10.00"),
    },
  ],
});

describe("Cardbit store isolation and pack sizes", () => {
  it("requires the dedicated deployment setting and exact permanent shop", () => {
    expect(isCardbit(CARDBIT_SHOP, {})).toBe(false);
    expect(isCardbit("poke-collect.myshopify.com", env)).toBe(false);
    expect(cardbitsConfig("poke-collect.myshopify.com", env)).toBeNull();
    expect(
      cardbitsConfig(CARDBIT_SHOP, { ...env, CARDBIT_COMMERCE_MODE: "" }),
    ).toBeNull();
  });
  it("respects copy counts and never fills a short or malformed example", () => {
    const pool = [
      { card: "A", copies: 2 },
      { card: "B", copies: 1 },
    ];
    expect(samplePack(pool, 3, () => 0)).toEqual(["A", "A", "B"]);
    expect(samplePack(pool, 4)).toEqual([]);
    expect(samplePack(pool, -1)).toEqual([]);
    expect(samplePack([{ card: "A", copies: 0.5 }], 1)).toEqual([]);
    expect(pool[0].copies).toBe(2);
  });
  it("counts a printing or tier once per complete remaining pack", () => {
    const slots = ["A", "A", "B", "A", "B", "A", "C"].map((cardId) => ({
      cardId,
      card: { tier: cardId === "B" ? "Rare" : "Base" },
    }));
    const f = packFrequencies(slots, 3);
    expect(f.packs).toBe(2);
    expect(f.cards.get("A")).toBe(2);
    expect(f.tiers.get("Rare")).toBe(2);
    expect(f.cards.has("C")).toBe(false);
  });
});

describe("test funding verification", () => {
  it("accepts fully captured funds for known test items and a signed-in QA owner", () => {
    expect(verifiedFunding(captured(), config)).toEqual({
      id: "gid://shopify/Order/33",
      customerId: qa,
      amount: 1000,
    });
  });
  it("rejects unpaid, refunded, live, partial, unapproved or ambiguous funding", () => {
    const o = captured();
    for (const patch of [
      { test: false },
      { cancelledAt: "yesterday" },
      { displayFinancialStatus: "AUTHORIZED" },
      { customer: null },
      { customer: { id: "other" } },
      { totalPriceSet: usd("9") },
      { lineItems: { ...o.lineItems, pageInfo: { hasNextPage: true } } },
      {
        lineItems: {
          ...o.lineItems,
          nodes: [{ quantity: 2, variant: { id: "other" } }],
        },
      },
      { transactions: [] },
      { transactions: Array(100).fill(o.transactions[0]) },
    ])
      expect(verifiedFunding({ ...o, ...patch }, config)).toBeNull();
    for (const patch of [
      { test: false },
      { status: "FAILURE" },
      { kind: "AUTHORIZATION" },
      { gateway: "another" },
      { amountSet: usd("9.99") },
    ])
      expect(
        verifiedFunding(
          { ...o, transactions: [{ ...o.transactions[0], ...patch }] },
          config,
        ),
      ).toBeNull();
  });
});

describe("destination shipping", () => {
  const address = parcelAddress({
    lastName: " Sample ",
    address1: "1 Example Way",
    city: "Denver",
    provinceCode: "co",
    zip: "80202",
    countryCode: "us",
  });
  const card = (id: string) => ({
    id,
    series: { storePurchase: false },
    slot: { card: { variantId: variant, title: "Test" } },
  });
  const admin = (amount: string) =>
    ({
      graphql: async () =>
        Response.json({
          data: {
            draftOrderAvailableDeliveryOptions: {
              availableShippingRates: [
                {
                  handle: "post",
                  title: "Standard",
                  price: { amount, currencyCode: "USD" },
                },
                {
                  handle: "vault",
                  title: "Keep in vault",
                  price: { amount: "0", currencyCode: "USD" },
                },
                {
                  handle: "pickup",
                  title: "Local Pickup",
                  price: { amount: "0", currencyCode: "USD" },
                },
                {
                  handle: "foreign",
                  title: "Other",
                  price: { amount: "4", currencyCode: "CAD" },
                },
              ],
            },
          },
        }),
    }) as unknown as AdminApiContext;
  it("groups copy quantities and preserves original inventory treatment", () => {
    expect(parcelLines([card("one"), card("two")], "USD")[0]).toMatchObject({
      variantId: variant,
      quantity: 2,
    });
    expect(
      parcelLines(
        [{ ...card("three"), series: { storePurchase: true } }],
        "USD",
      )[0],
    ).toMatchObject({ requiresShipping: true, quantity: 1 });
    expect(address.lastName).toBe("Sample");
    expect(address.countryCode).toBe("US");
    expect(() => parcelAddress({})).toThrow();
  });
  it("binds the available rate to customer, destination, exact copies and latest amount", async () => {
    const a = await quoteParcel(
      admin("8"),
      CARDBIT_SHOP,
      qa,
      [card("one")],
      address,
    );
    expect(a).toHaveLength(1);
    for (const quotes of [
      await quoteParcel(admin("9"), CARDBIT_SHOP, qa, [card("one")], address),
      await quoteParcel(
        admin("8"),
        CARDBIT_SHOP,
        "other",
        [card("one")],
        address,
      ),
      await quoteParcel(admin("8"), CARDBIT_SHOP, qa, [card("two")], address),
      await quoteParcel(admin("8"), CARDBIT_SHOP, qa, [card("one")], {
        ...address,
        zip: "10001",
      }),
    ])
      expect(quotes[0].quoteKey).not.toBe(a[0].quoteKey);
  });
  it("recognizes only the signed customer's paid order from the saved shipping draft", () => {
    const o = captured();
    expect(paidParcelMatches(o, o.id, qa)).toBe(true);
    expect(paidParcelMatches(o, "other", qa)).toBe(false);
    expect(paidParcelMatches(o, o.id, "other")).toBe(false);
    expect(
      paidParcelMatches({ ...o, displayFinancialStatus: "PENDING" }, o.id, qa),
    ).toBe(false);
  });
});
