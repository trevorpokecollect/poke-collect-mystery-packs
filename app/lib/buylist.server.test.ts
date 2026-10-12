import { describe, expect, it } from "vitest";
import { buildBuylistReport } from "./buylist.server";

describe("buylist report", () => {
  it("prices each card at its variant's cash and credit offers and lists cards with no offer", async () => {
    const fetcher = (async (url: string) => {
      const name = new URL(url).searchParams.get("name");
      const products =
        name === "Tatsugiri 186 - SV06 Twilight Masquerade Holofoil"
          ? [{ store_pass_variant_info: [{ id: 111, offer_price: 15.28, offer_price_credit: 18.34 }, { id: 112, offer_price: 9.17, offer_price_credit: 11 }] }]
          : [];
      return new Response(JSON.stringify({ products }));
    }) as unknown as typeof fetch;
    const report = await buildBuylistReport(
      [
        { title: "Tatsugiri 186 - SV06 Twilight Masquerade Holofoil - Near Mint", variantId: "gid://shopify/ProductVariant/111", quantity: 2, marketValue: 23.5, tier: "Master" },
        { title: "Pidgey 1 - Base - Near Mint", variantId: "gid://shopify/ProductVariant/999", quantity: 3, marketValue: 1, tier: "Poke" },
      ],
      fetcher,
    );
    expect(report.cash).toBe(30.56);
    expect(report.credit).toBe(36.68);
    expect(report.copies).toBe(5);
    expect(report.matchedCopies).toBe(2);
    expect(report.missing).toEqual([{ title: "Pidgey 1 - Base - Near Mint", quantity: 3, marketValue: 1 }]);
    expect(report.byTier.Master).toEqual({ copies: 2, cash: 30.56, market: 47 });
  });
});
