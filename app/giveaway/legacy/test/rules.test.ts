import { describe, expect, it } from "vitest";
import {
  purchaseRulesSchema,
  scoreOrder,
  type ScorableOrder,
} from "../app/lib/entries/rules";

const P = (n: number) => `gid://shopify/Product/${n}`;
const V = (n: number) => `gid://shopify/ProductVariant/${n}`;

const order = (over: Partial<ScorableOrder> = {}): ScorableOrder => ({
  createdAt: new Date("2026-10-15T12:00:00Z"),
  sourceName: "web",
  subtotal: 100,
  total: 108,
  giftCardAmount: 0,
  lines: [
    { productId: P(1), variantId: V(11), quantity: 2, unitPrice: 30 }, // booster box
    { productId: P(2), variantId: V(21), quantity: 4, unitPrice: 10 }, // packs
  ],
  ...over,
});

describe("scoreOrder", () => {
  it("defaults to 1 entry per $1 of subtotal", () => {
    expect(scoreOrder(purchaseRulesSchema.parse({}), order()).entries).toBe(
      100,
    );
  });

  it("supports fixed entries per order and minimum order value", () => {
    const rules = purchaseRulesSchema.parse({
      base: { mode: "fixed", entries: 5 },
      minOrderValue: 150,
    });
    expect(scoreOrder(rules, order()).entries).toBe(0);
    expect(scoreOrder(rules, order({ subtotal: 200 })).entries).toBe(5);
  });

  it("rejects orders from a disallowed source", () => {
    const rules = purchaseRulesSchema.parse({ orderSource: "online" });
    const r = scoreOrder(rules, order({ sourceName: "pos" }));
    expect(r.valid).toBe(false);
    expect(r.entries).toBe(0);
  });

  it("deducts gift card payments from the base", () => {
    const rules = purchaseRulesSchema.parse({});
    expect(scoreOrder(rules, order({ giftCardAmount: 40 })).entries).toBe(60);
  });

  it("scores bundles from a shared pool, highest reward first", () => {
    const rules = purchaseRulesSchema.parse({
      base: { mode: "none" },
      bundles: [
        {
          name: "box+2 packs",
          entries: 50,
          groups: [
            { productIds: [P(1)], quantity: 1 },
            { productIds: [P(2)], quantity: 2 },
          ],
        },
        {
          name: "4 packs",
          entries: 10,
          groups: [{ productIds: [P(2)], quantity: 4 }],
        },
      ],
    });
    const r = scoreOrder(rules, order());
    // Two box bundles consume all 4 packs, leaving nothing for the pack bundle.
    expect(r.bundles).toEqual([
      { name: "box+2 packs", times: 2, entries: 100 },
    ]);
    expect(r.entries).toBe(100);
  });

  it("applies product rules, skipping units used by bundles, plus a spend bonus", () => {
    const rules = purchaseRulesSchema.parse({
      base: { mode: "none" },
      bundles: [
        {
          name: "2 packs",
          entries: 3,
          groups: [{ productIds: [P(2)], quantity: 2 }],
        },
      ],
      productRules: [
        { name: "packs", productIds: [P(2)], mode: "per_unit", entries: 2 },
        {
          name: "boxes",
          variantIds: [V(11)],
          mode: "per_amount",
          entries: 1,
          amount: 10,
          bonusThreshold: 50,
          bonusEntries: 7,
        },
      ],
    });
    const r = scoreOrder(rules, order());
    expect(r.bundles[0].entries).toBe(6); // 2 bundles x 3
    expect(r.products).toEqual([{ name: "boxes", entries: 6 + 7 }]);
    expect(r.entries).toBe(19);
  });

  it("multiplies by the highest overlapping period and additive AOV boosters", () => {
    const rules = purchaseRulesSchema.parse({
      base: { mode: "fixed", entries: 10 },
      periodMultipliers: [
        { start: "2026-10-01", end: "2026-10-31", multiplier: 2 },
        { start: "2026-10-10", end: "2026-10-20", multiplier: 3 },
      ],
      aovBoosters: [
        { name: "box booster", productIds: [P(1)], multiplier: 1.5 },
      ],
    });
    const r = scoreOrder(rules, order());
    expect(r.periodMultiplier).toBe(3);
    expect(r.aovMultiplier).toBe(3); // 1.5 x qty 2, added not compounded
    expect(r.entries).toBe(90);
  });

  it("caps rule counts like the GiveawayNinja limits", () => {
    const tooMany = Array.from({ length: 16 }, (_, i) => ({
      name: `r${i}`,
      mode: "per_unit",
      entries: 1,
    }));
    expect(
      purchaseRulesSchema.safeParse({ productRules: tooMany }).success,
    ).toBe(false);
  });
});
