import { describe, expect, it } from "vitest";
import { drawWinners, newSeed, snapshotHash } from "../app/lib/draw";

const tickets = [
  { entrantId: "a", entries: 1 },
  { entrantId: "b", entries: 1 },
  { entrantId: "c", entries: 98 },
  { entrantId: "z", entries: 0 },
];

describe("drawWinners", () => {
  it("is reproducible from the seed regardless of input order", () => {
    const seed = newSeed();
    expect(drawWinners(tickets, 2, seed)).toEqual(
      drawWinners([...tickets].reverse(), 2, seed),
    );
    expect(snapshotHash(tickets)).toBe(snapshotHash([...tickets].reverse()));
  });

  it("never picks the same entrant twice or an entrant with zero entries", () => {
    const w = drawWinners(tickets, 10, newSeed());
    expect(new Set(w).size).toBe(w.length);
    expect(w).toHaveLength(3);
    expect(w).not.toContain("z");
  });

  it("weights by entries", () => {
    let cWins = 0;
    for (let i = 0; i < 500; i++)
      if (drawWinners(tickets, 1, newSeed())[0] === "c") cWins++;
    expect(cWins / 500).toBeGreaterThan(0.9);
  });
});
