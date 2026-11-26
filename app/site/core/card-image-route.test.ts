import { describe, expect, it } from "vitest";
import { cardImageSource } from "../../routes/api.card-image";

describe("card image copy route", () => {
  it("accepts TCGplayer product image URLs only", () => {
    expect(cardImageSource("https://product-images.tcgplayer.com/fit-in/400x400/716200.jpg")?.href).toBe("https://product-images.tcgplayer.com/fit-in/400x400/716200.jpg");
    expect(cardImageSource("https://tcgplayer-cdn.tcgplayer.com/product/716200_in_1000x1000.jpg")).not.toBeNull();
    for (const bad of [
      null, "http://product-images.tcgplayer.com/fit-in/400x400/1.jpg", "https://evil.com/fit-in/400x400/1.jpg",
      "https://product-images.tcgplayer.com/fit-in/400x400/1.jpg?x=1", "https://product-images.tcgplayer.com/../admin",
      "https://product-images.tcgplayer.com.evil.com/fit-in/400x400/1.jpg", "https://user@product-images.tcgplayer.com/fit-in/400x400/1.jpg",
    ]) expect(cardImageSource(bad)).toBeNull();
  });
});
