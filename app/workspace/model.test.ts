import { describe, it, expect } from "vitest";
import {
  planPool,
  offer,
  printingKey,
  portfolio,
  validatePolicy,
  initialPolicy,
  type Stock,
  type Recipe,
} from "./model";
const base: Stock = {
  key: "1|en|holo|near mint",
  name: "Test A",
  set: "Test set",
  number: "1",
  language: "English",
  finish: "Holo",
  condition: "Near Mint",
  retail: 110,
  cash: 10,
  market: 90,
  retailDate: "2026-11-23",
  marketDate: null,
  image: null,
  variantId: "cardbit-1",
  productId: "p",
  inventoryItemId: "i",
  locationId: "l",
  available: 2,
};
const recipe: Recipe = {
  edition: "booster",
  title: "Booster QA",
  language: "English",
  set: "Test set",
  condition: "Near Mint",
  packs: 1,
  price: 500,
  min: 0,
  max: 10000,
  target: 11000,
  copies: 2,
  minHits: 0,
  hit: 2000,
  tiers: ["Common", "Uncommon", "Rare", "Epic", "Legendary"].map((name, i) => ({
    name,
    min: [0, 100, 400, 600, 1200][i],
  })),
};
describe("Cardbit owner workspace", () => {
  it("joins only exact printing identities", () => {
    expect(printingKey(1, "Japanese", "Holo", "Near Mint")).toBe(
      "1|ja|holo|near mint",
    );
    expect(printingKey(1, "", "Holo", "Near Mint")).toBeNull();
  });
  it("prices a positive cash offer using printing, then range, then default", () => {
    const policy = {
      rate: 8000,
      bands: [{ set: "Test set", min: 100, max: 111, rate: 7500 }],
      overrides: { [base.key]: 9000 },
    };
    expect(offer(base, policy)).toBe(99);
    expect(offer(base, { ...policy, overrides: {} })).toBe(83);
    expect(offer({ ...base, retail: 111 }, { ...policy, overrides: {} })).toBe(
      89,
    );
    expect(offer({ ...base, cash: 0 }, policy)).toBeNull();
    expect(offer(base, { ...initialPolicy, basis: "market" })).toBe(72);
    expect(
      offer({ ...base, market: null }, { ...initialPolicy, basis: "market" }),
    ).toBeNull();
    expect(() =>
      validatePolicy({
        ...initialPolicy,
        bands: [{ set: "", min: 300, max: 100, rate: 8500 }],
      }),
    ).toThrow();
  });
  it("keeps zero inventory, ineligible sets/languages and unquoted copies out of Booster", () => {
    const allowed = [
      base,
      { ...base, key: "two", variantId: "2" },
      { ...base, key: "three", variantId: "3" },
    ];
    const denied = [
      { ...base, key: "foreign", language: "Japanese" },
      { ...base, key: "other", set: "Other" },
      { ...base, key: "empty", available: 0 },
      { ...base, key: "no-offer", cash: null },
    ];
    const result = planPool([...allowed, ...denied], recipe);
    expect(result.reduce((n, r) => n + r.quantity, 0)).toBe(5);
    expect(
      result.every(
        (c) => allowed.some((a) => a.key === c.key) && c.quantity <= 2,
      ),
    ).toBe(true);
    expect(() =>
      planPool([base, { ...base, variantId: "duplicate" }], recipe),
    ).toThrow(/Only 2/);
    expect(
      planPool([base], { ...recipe, edition: "mystery", price: 100 })[0]
        .quantity,
    ).toBe(1);
  });
  it("keeps market and Cardbits coverage independent and counts every held copy", () => {
    const holdings = [
      { ...base, qty: 2, bits: 88, history: [] },
      { ...base, key: "2", qty: 1, market: null, bits: null, history: [] },
    ];
    expect(portfolio(holdings, [], "now")).toMatchObject({
      count: 3,
      priced: 2,
      marked: 2,
      bits: 176,
      market: 180,
    });
    expect(portfolio([holdings[1]], [], "now")).toMatchObject({
      count: 1,
      priced: 0,
      bits: null,
      market: null,
    });
  });
});
