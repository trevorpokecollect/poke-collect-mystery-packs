import { describe, expect, it } from "vitest";
import { DEFAULT_SPIN_TABLE, displayOdds, pickSlice, totalWeight, validTable, weightedSlices } from "./cardbit-spinner";

describe("Daily Spinner rules", () => {
  it("ships valid default tables with better card odds at higher tiers", () => {
    expect(validTable(DEFAULT_SPIN_TABLE)).toBe(true);
    const card = (t: string) => displayOdds(DEFAULT_SPIN_TABLE[t]).find((o) => o.kind === "card")!.percent;
    expect(card("basic")).toBe(2);
    expect(card("silver")).toBeGreaterThan(card("basic"));
    expect(card("cobalt")).toBeGreaterThan(card("gold"));
  });
  it("raises card weight 10% per streak day, capped at 7 days", () => {
    const w = (streak: number) => weightedSlices(DEFAULT_SPIN_TABLE.basic, streak)[0].weight;
    expect(w(0)).toBe(20);
    expect(w(3)).toBe(26);
    expect(w(7)).toBe(34);
    expect(w(30)).toBe(34);
  });
  it("maps every ticket to exactly one slice", () => {
    const slices = DEFAULT_SPIN_TABLE.basic;
    const counts = new Map<string, number>();
    for (let t = 0; t < totalWeight(slices); t++) {
      const s = pickSlice(slices, t);
      const k = s.kind + (s.amount ?? "");
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect(counts.get("card")).toBe(20);
    expect(counts.get("xp25")).toBe(530);
  });
  it("rejects tables without a fallback slice or with bad amounts", () => {
    expect(validTable({ basic: [{ kind: "card", weight: 1 }] })).toBe(false);
    expect(validTable({ basic: [{ kind: "xp", amount: -1, weight: 1 }] })).toBe(false);
    expect(validTable({ basic: [{ kind: "cash", amount: 5, weight: 1 }] })).toBe(false);
  });
});
