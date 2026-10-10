import { describe, expect, it } from "vitest";
import { buildPool, DEFAULT_TIER_RULES, normalizeTierRules, tierFor } from "./pool-builder";

// Small deterministic RNG so failures reproduce.
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

// Inventory shaped like a singles shop: lots of cheap cards, a long tail of expensive ones.
function inventory(n: number, rand = seeded(7)) {
  return Array.from({ length: n }, (_, i) => {
    const value = Math.round((1 + 120 * rand() ** 4) * 4) / 4;
    return { variantId: `v${i}`, value };
  });
}

describe("tiers", () => {
  it("assigns the highest tier the value reaches", () => {
    expect(tierFor(2, DEFAULT_TIER_RULES)).toBe("Poke");
    expect(tierFor(9.99, DEFAULT_TIER_RULES)).toBe("Poke");
    expect(tierFor(10, DEFAULT_TIER_RULES)).toBe("Great");
    expect(tierFor(25, DEFAULT_TIER_RULES)).toBe("Ultra");
    expect(tierFor(99, DEFAULT_TIER_RULES)).toBe("Master");
  });

  it("sorts rules and rejects duplicates", () => {
    expect(normalizeTierRules([{ name: "B", min: 10 }, { name: "A", min: 0 }]).map((r) => r.name)).toEqual(["A", "B"]);
    expect(() => normalizeTierRules([{ name: "A", min: 0 }, { name: "B", min: 0 }])).toThrow();
    expect(() => normalizeTierRules([])).toThrow();
  });
});

describe("buildPool", () => {
  const rules = { count: 100, minValue: 2, maxValue: 100, targetAverage: 10 };

  it("hits the target average with distinct cards inside the range", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const result = buildPool(inventory(2000), rules, seeded(seed));
      expect(result.cards).toHaveLength(100);
      expect(new Set(result.cards.map((c) => c.variantId)).size).toBe(100);
      expect(result.cards.every((c) => c.value >= 2 && c.value <= 100)).toBe(true);
      expect(Math.abs(result.average - 10)).toBeLessThan(0.01);
    }
  });

  it("comes out different each time", () => {
    const a = buildPool(inventory(2000), rules, seeded(11)).cards.map((c) => c.variantId).sort();
    const b = buildPool(inventory(2000), rules, seeded(12)).cards.map((c) => c.variantId).sort();
    expect(a).not.toEqual(b);
  });

  it("works for small pools", () => {
    const result = buildPool(inventory(500), { count: 20, minValue: 2, maxValue: 100, targetAverage: 15 }, seeded(3));
    expect(result.cards).toHaveLength(20);
    expect(Math.abs(result.average - 15)).toBeLessThan(0.01);
  });

  it("says so when there aren't enough cards", () => {
    expect(() => buildPool(inventory(50), rules, seeded(1))).toThrow(/Only \d+ cards/);
  });

  it("gets as close as it can when the target is out of reach", () => {
    const cheap = Array.from({ length: 300 }, (_, i) => ({ variantId: `c${i}`, value: 2 + (i % 4) }));
    const result = buildPool(cheap, rules, seeded(1));
    expect(result.cards).toHaveLength(100);
    expect(result.average).toBeLessThan(10);
  });
});
