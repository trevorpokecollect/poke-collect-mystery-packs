import { describe, expect, it } from "vitest";
import { dealFor, pickRow, tcgplayerIdFromImage } from "./price-guide.server";

describe("price guide", () => {
  it("reads the TCGplayer id from the card image name", () => {
    expect(tcgplayerIdFromImage("https://cdn.shopify.com/s/files/1/0468/5299/7280/files/716225.jpg?v=1789571619")).toBe(716225);
    expect(tcgplayerIdFromImage("https://cdn.shopify.com/s/files/1/files/523742_in_1000x1000.jpg")).toBe(523742);
    expect(tcgplayerIdFromImage("https://cdn.shopify.com/s/files/1/files/charizard-slab.png")).toBeNull();
    expect(tcgplayerIdFromImage(null)).toBeNull();
  });

  it("picks the printing named in the title", () => {
    const rows = [
      { productId: 1, subTypeName: "Normal", marketPrice: 0.2 },
      { productId: 1, subTypeName: "Holofoil", marketPrice: 3 },
      { productId: 1, subTypeName: "Reverse Holofoil", marketPrice: 1.5 },
    ];
    expect(pickRow(rows, "Scraggy - 140/128 - ME 30th Celebration Holofoil - Near Mint")?.marketPrice).toBe(3);
    expect(pickRow(rows, "Pikachu - 025 - Set Reverse Holofoil - Near Mint")?.marketPrice).toBe(1.5);
    expect(pickRow(rows, "Pikachu - 025 - Set - Near Mint")?.marketPrice).toBe(0.2);
    expect(pickRow([{ productId: 1, subTypeName: "Holofoil", marketPrice: 9 }], "Card - Near Mint")?.marketPrice).toBe(9);
    expect(pickRow([{ productId: 1, subTypeName: "Holofoil", marketPrice: null }], "Card Holofoil")).toBeNull();
  });

  it("rates a price against the market like the seller's slider", () => {
    expect(dealFor(8, 10)).toBe("great");
    expect(dealFor(10, 10)).toBe("good");
    expect(dealFor(11, 10)).toBe("fair");
    expect(dealFor(13, 10)).toBe("high");
    expect(dealFor(20, 10)).toBe("over");
    expect(dealFor(10, null)).toBeNull();
  });
});
