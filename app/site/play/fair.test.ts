import { describe, expect, it } from "vitest";
import { fairDraw, fairIndex, sha256 } from "./fair.server";

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
