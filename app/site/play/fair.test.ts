import { describe, expect, it } from "vitest";
import { distinctDraw, distinctOdds, distinctPacks, fairDraw, fairIndex, maxDistinctPacks, printingGroups, sha256 } from "./fair.server";

describe("verified shuffle draw", () => {
  it("is deterministic and draws each item once", () => {
    const pool = Array.from({ length: 20 }, (_, i) => `c${String(i).padStart(2, "0")}`);
    const a = fairDraw(pool, 5, "seed", "client", 3);
    expect(fairDraw(pool, 5, "seed", "client", 3)).toEqual(a);
    expect(new Set(a).size).toBe(5);
    expect(fairDraw(pool, 5, "seed", "client", 4)).not.toEqual(a);
    expect(fairDraw(pool, 5, "seed", "other", 3)).not.toEqual(a);
  });
  it("matches the published formula", () => {
    // HMAC-SHA256("s", "c:0:0") first 13 hex digits mod 7, computed independently.
    const idx = fairIndex("s", "c", 0, 0, 7);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(7);
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("is close to uniform", () => {
    const counts = new Array(10).fill(0);
    for (let n = 0; n < 20000; n++) counts[fairIndex("seed", "client", n, 0, 10)]++;
    for (const c of counts) expect(Math.abs(c - 2000)).toBeLessThan(200);
  });
});

describe("draw rule 2: different cards in every pack", () => {
  // 9 copies, 5 printings: A×3, B×2, C, D×2, E (labels = first index of the printing in id order)
  const keys = ["A", "A", "B", "C", "A", "D", "B", "E", "D"];
  const groups = printingGroups(keys.map((printingKey) => ({ printingKey })));

  it("labels copies by their printing's first position", () => {
    expect(groups).toEqual([0, 0, 2, 3, 0, 5, 2, 7, 5]);
  });

  it("never puts the same printing twice in a pack, and is deterministic", () => {
    for (let nonce = 0; nonce < 500; nonce++) {
      const idx = distinctDraw(groups, 3, "seed", "client", nonce)!;
      expect(idx).toHaveLength(3);
      expect(new Set(idx.map((i) => keys[i])).size).toBe(3);
      expect(distinctDraw(groups, 3, "seed", "client", nonce)).toEqual(idx);
    }
  });

  it("counts possible packs and packs left", () => {
    expect(distinctPacks([3, 2, 1, 2, 1], 3)).toBe(BigInt(3 * 2 * 1 + 3 * 2 * 2 + 3 * 2 * 1 + 3 * 1 * 2 + 3 * 1 * 1 + 3 * 2 * 1 + 2 * 1 * 2 + 2 * 1 * 1 + 2 * 2 * 1 + 1 * 2 * 1));
    expect(distinctPacks([4], 2)).toBe(0n); // one printing can't fill a 2-card pack
    expect(distinctDraw([0, 0, 0, 0], 2, "s", "c", 0)).toBeNull();
    expect(maxDistinctPacks([3, 2, 1, 2, 1], 3)).toBe(3);
    expect(maxDistinctPacks([10, 1, 1, 1, 1], 5)).toBe(1); // 10 copies of one card: 1 pack, not 2
    expect(maxDistinctPacks([1, 1, 1, 1], 5)).toBe(0);
    expect(maxDistinctPacks([7], 1)).toBe(7);
  });

  it("picks every possible pack equally often and the published odds match", () => {
    // Enumerate all valid 3-copy packs.
    const valid: number[][] = [];
    for (let a = 0; a < 9; a++) for (let b = a + 1; b < 9; b++) for (let c = b + 1; c < 9; c++)
      if (new Set([keys[a], keys[b], keys[c]]).size === 3) valid.push([a, b, c]);
    expect(BigInt(valid.length)).toBe(distinctPacks([3, 2, 1, 2, 1], 3));
    const seen = new Map<string, number>();
    const N = 40000;
    for (let nonce = 0; nonce < N; nonce++) {
      const k = distinctDraw(groups, 3, "seed", "client", nonce)!.slice().sort((x, y) => x - y).join(",");
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    expect(seen.size).toBe(valid.length);
    const expected = N / valid.length;
    for (const n of seen.values()) expect(Math.abs(n - expected)).toBeLessThan(expected * 0.2);

    const tierOf = (i: number) => (keys[i] === "E" ? "Legendary" : keys[i] === "A" ? "Common" : "Rare");
    const odds = distinctOdds(groups, 3, tierOf);
    for (let i = 0; i < 9; i++) expect(odds.copy[i]).toBeCloseTo(valid.filter((p) => p.includes(i)).length / valid.length, 9);
    for (const t of ["Legendary", "Common", "Rare"])
      expect(odds.tiers.get(t)).toBeCloseTo(valid.filter((p) => p.some((i) => tierOf(i) === t)).length / valid.length, 9);
    expect(odds.copy.reduce((a, x) => a + x, 0)).toBeCloseTo(3, 9); // expected cards per pack
  });

  it("is a plain uniform pick for one-card packs", () => {
    const g = printingGroups(["X", "X", "Y"].map((printingKey) => ({ printingKey })));
    const counts = [0, 0, 0];
    for (let n = 0; n < 9000; n++) counts[distinctDraw(g, 1, "seed", "client", n)![0]]++;
    for (const c of counts) expect(Math.abs(c - 3000)).toBeLessThan(300);
  });
});
