import { describe, expect, it } from "vitest";
import { buildPool, buildWithLimits, copiesAllowed, DEFAULT_TIER_RULES, normalizeTierRules, tierFor } from "./pool-builder";

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
    expect(tierFor(5, DEFAULT_TIER_RULES)).toBe("Poke");
    expect(tierFor(5.01, DEFAULT_TIER_RULES)).toBe("Great");
    expect(tierFor(10, DEFAULT_TIER_RULES)).toBe("Great");
    expect(tierFor(10.01, DEFAULT_TIER_RULES)).toBe("Ultra");
    expect(tierFor(25, DEFAULT_TIER_RULES)).toBe("Ultra");
    expect(tierFor(25.01, DEFAULT_TIER_RULES)).toBe("Master");
    expect(tierFor(50, DEFAULT_TIER_RULES)).toBe("Master");
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

  it("takes up to 3 copies of a card in pools over 50, never more than in stock", () => {
    expect(copiesAllowed(50)).toBe(1);
    expect(copiesAllowed(51)).toBe(3);
    // 60 cards with 5 copies each: a 100-card pool needs some cards more than once.
    const stock = inventory(60).map((c) => ({ ...c, available: 5 }));
    stock[0].available = 2;
    const result = buildPool(stock, { ...rules, targetAverage: 8, maxCopies: copiesAllowed(100) }, seeded(4));
    expect(result.cards.reduce((n, c) => n + c.quantity, 0)).toBe(100);
    expect(result.cards.every((c) => c.quantity >= 1 && c.quantity <= 3)).toBe(true);
    expect(result.cards.find((c) => c.variantId === "v0")?.quantity ?? 0).toBeLessThanOrEqual(2);
    expect(new Set(result.cards.map((c) => c.variantId)).size).toBe(result.cards.length);
  });

  it("keeps one copy each when copies aren't allowed", () => {
    const stock = inventory(2000).map((c) => ({ ...c, available: 4 }));
    const result = buildPool(stock, rules, seeded(2));
    expect(result.cards).toHaveLength(100);
    expect(result.cards.every((c) => c.quantity === 1)).toBe(true);
  });
});

describe("buildPool minimum hits", () => {
  it("keeps at least minHits cards at or above the hit value while hitting the average", () => {
    const candidates = [
      ...Array.from({ length: 400 }, (_, i) => ({ variantId: `c${i}`, value: 0.5 + (i % 4) * 0.5 })),
      ...Array.from({ length: 80 }, (_, i) => ({ variantId: `h${i}`, value: 5 + (i % 6) })),
      ...Array.from({ length: 20 }, (_, i) => ({ variantId: `m${i}`, value: 20 + i })),
      // Just under the hit value, so the nearest swap is never a hit.
      ...Array.from({ length: 30 }, (_, i) => ({ variantId: `u${i}`, value: 4.99 })),
    ];
    const { cards, average } = buildPool(candidates, { count: 200, minValue: 0.5, maxValue: 50, targetAverage: 2.5, minHits: 40, hitValue: 5.01 });
    const hits = cards.filter((c) => c.value >= 5.01).reduce((n, c) => n + c.quantity, 0);
    expect(hits).toBeGreaterThanOrEqual(40);
    expect(average).toBeCloseTo(2.5, 1);
  });

  it("says when there aren't enough hits in stock", () => {
    const candidates = Array.from({ length: 50 }, (_, i) => ({ variantId: `c${i}`, value: i < 3 ? 10 : 1 }));
    expect(() => buildPool(candidates, { count: 20, minValue: 0.5, maxValue: 50, targetAverage: 2, minHits: 5, hitValue: 5 })).toThrow(/Only 3 cards/);
  });
});

describe("buildPool filler max", () => {
  it("leaves out cards between the filler max and the hit value", () => {
    const candidates = Array.from({ length: 300 }, (_, i) => ({ variantId: `c${i}`, value: 1 + (i % 30) }));
    const { cards } = buildPool(candidates, { count: 100, minValue: 1, maxValue: 30, targetAverage: 4, minHits: 20, hitValue: 5.01, fillerMax: 2 });
    expect(cards.every((c) => c.value <= 2 || c.value >= 5.01)).toBe(true);
  });
});

describe("buildPool two hit floors", () => {
  it("keeps both the hit and the big-hit minimums", () => {
    const candidates = [
      ...Array.from({ length: 400 }, (_, i) => ({ variantId: `c${i}`, value: 1 + (i % 3) * 0.5 })),
      ...Array.from({ length: 200 }, (_, i) => ({ variantId: `g${i}`, value: 5.5 + (i % 4) })),
      ...Array.from({ length: 80 }, (_, i) => ({ variantId: `u${i}`, value: 10.5 + (i % 20) })),
    ];
    const { cards, average } = buildPool(candidates, {
      count: 300, minValue: 1, maxValue: 35, targetAverage: 3.4,
      minHits: 80, hitValue: 5.01, minBigHits: 25, bigHitValue: 10.01, fillerMax: 2,
    });
    const at = (v: number) => cards.filter((c) => c.value >= v).reduce((n, c) => n + c.quantity, 0);
    expect(at(5.01)).toBeGreaterThanOrEqual(80);
    expect(at(10.01)).toBeGreaterThanOrEqual(25);
    expect(average).toBeCloseTo(3.4, 1);
  });
});

describe("buildPool three hit floors", () => {
  it("keeps the hit, big-hit and top-hit minimums", () => {
    const candidates = [
      ...Array.from({ length: 400 }, (_, i) => ({ variantId: `c${i}`, value: 1 + (i % 3) * 0.5 })),
      ...Array.from({ length: 200 }, (_, i) => ({ variantId: `g${i}`, value: 5.5 + (i % 4) })),
      ...Array.from({ length: 60 }, (_, i) => ({ variantId: `u${i}`, value: 10.5 + (i % 4) })),
      ...Array.from({ length: 40 }, (_, i) => ({ variantId: `m${i}`, value: 15.5 + (i % 15) })),
    ];
    const { cards, average } = buildPool(candidates, {
      count: 300, minValue: 1, maxValue: 35, targetAverage: 3.6,
      minHits: 80, hitValue: 5.01, minBigHits: 30, bigHitValue: 10.01, minTopHits: 12, topHitValue: 15.01, fillerMax: 2,
    });
    const at = (v: number) => cards.filter((c) => c.value >= v).reduce((n, c) => n + c.quantity, 0);
    expect(at(5.01)).toBeGreaterThanOrEqual(80);
    expect(at(10.01)).toBeGreaterThanOrEqual(30);
    expect(at(15.01)).toBeGreaterThanOrEqual(12);
    expect(average).toBeCloseTo(3.6, 1);
  });
});

describe("buildWithLimits", () => {
  const rules = { count: 300, minValue: 1, maxValue: 130, targetAverage: 6 };
  const stock = () => inventory(150).map((c, i) => ({ ...c, available: 6, japanese: i % 3 === 0 }));

  it("uses the store copy rule unless the build sets maxCopies, and never more than 5", () => {
    const most = (r: object) => Math.max(...buildWithLimits(stock(), { ...rules, ...r }, seeded(3)).cards.map((c) => c.quantity));
    expect(most({})).toBeLessThanOrEqual(3);
    expect(most({ maxCopies: 5 })).toBe(5);
    expect(most({ maxCopies: 9 })).toBe(5);
  });

  it("keeps the Japanese share under the cap", () => {
    const { cards } = buildWithLimits(stock(), { ...rules, maxCopies: 5, maxJapanesePercent: 40 }, seeded(5));
    const jp = cards.reduce((n, c) => n + (c.japanese ? c.quantity : 0), 0);
    expect(jp / 300).toBeLessThanOrEqual(0.4);
  });

  it("says so when no build fits the cap", () => {
    const allJapanese = stock().map((c) => ({ ...c, japanese: true }));
    expect(() => buildWithLimits(allJapanese, { ...rules, maxCopies: 5, maxJapanesePercent: 50 }, seeded(5))).toThrow(/over 50% Japanese/);
  });
});
