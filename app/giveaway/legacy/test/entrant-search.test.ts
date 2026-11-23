import { describe, expect, it } from "vitest";
import { entrantSearchWhere } from "../app/lib/entries/search";

describe("entrant search", () => {
  it("matches every word in the name or email", () => {
    expect(entrantSearchWhere("  ")).toBeNull();
    const w = entrantSearchWhere(" Ash  Ketchum ")!;
    expect(w.AND).toHaveLength(2);
    expect(w.AND[0].OR[0]).toEqual({
      email: { contains: "Ash", mode: "insensitive" },
    });
    expect(w.AND[1].OR[1]).toEqual({
      name: { contains: "Ketchum", mode: "insensitive" },
    });
    expect(entrantSearchWhere("ash@gmail.com")!.AND).toHaveLength(1);
  });
});
