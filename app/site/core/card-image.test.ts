import { describe, expect, it } from "vitest";
import { cardImage, tcgplayerImage } from "./card-image";

describe("card art", () => {
  it("keeps the stored image", () => {
    expect(cardImage({ image: "https://product-images.tcgplayer.com/fit-in/400x400/517175.jpg", tcgplayerId: 1 })).toBe(
      "https://product-images.tcgplayer.com/fit-in/400x400/517175.jpg",
    );
  });
  it("falls back to the TCGplayer product image (Kyogre 117 ME promo had none)", () => {
    expect(cardImage({ image: null, tcgplayerId: 731799 })).toBe("https://product-images.tcgplayer.com/fit-in/1000x1000/731799.jpg");
    expect(cardImage({ image: "  ", tcgplayerId: 731799 })).toBe("https://product-images.tcgplayer.com/fit-in/1000x1000/731799.jpg");
  });
  it("has nothing to show without an image or product", () => {
    expect(cardImage({ image: null, tcgplayerId: null })).toBeNull();
    expect(tcgplayerImage(0)).toBeNull();
  });
});
