import { describe, expect, it } from "vitest";
import { brand, brandAttrs } from "./brand.server";

describe("per-site brand", () => {
  it("defaults to Poke-Collect so the existing install needs no new variables", () => {
    expect(brand({})).toMatchObject({ name: "Poke-Collect", supportEmail: "support@poke-collect.com", packProductHandle: "poke-collect-mystery-pack" });
  });
  it("reads a second site's values and escapes them for HTML attributes", () => {
    const b = brand({ BRAND_NAME: "Card<bit> \"Co\"", SUPPORT_EMAIL: "help@cardbit.com", PACK_PRODUCT_HANDLE: "cardbit-pack" });
    expect(b.packProductHandle).toBe("cardbit-pack");
    expect(brandAttrs(b)).toBe(' data-brand="Card&lt;bit&gt; &quot;Co&quot;" data-support="help@cardbit.com"');
  });
});
