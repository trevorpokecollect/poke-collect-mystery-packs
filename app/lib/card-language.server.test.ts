import { describe, expect, it } from "vitest";
import { languageOf } from "./card-language.server";

describe("languageOf", () => {
  it("reads StorePass's language tag", () => {
    expect(languageOf({ tags: ["Brand_Pokemon", "Language_Japanese"], productType: "Pokemon Single" })).toBe("japanese");
    expect(languageOf({ tags: ["Language_English"], productType: "Pokemon Single" })).toBe("english");
  });
  it("falls back to a Japanese product type, then English", () => {
    expect(languageOf({ tags: [], productType: "Pokemon Japanese Single" })).toBe("japanese");
    expect(languageOf({ tags: [], productType: null })).toBe("english");
  });
});
