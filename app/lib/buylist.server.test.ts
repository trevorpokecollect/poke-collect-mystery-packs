import { describe, expect, it } from "vitest";
import { buildBuylistReport } from "./buylist.server";

describe("buylist report", () => {
  it("prices each card at Card Broker's cash, credit and retail for its variant and lists cards with no offer", async () => {
    const asked: string[] = [];
    const fetcher = (async (url: string) => {
      asked.push(new URL(url).searchParams.get("variants") ?? "");
      return new Response(JSON.stringify({
        source: "card-broker",
        offers: [
          { variantId: "111", cash: 15.28, credit: 18.34, retail: 24 },
          { variantId: "999", cash: null, credit: null, retail: 1, unavailable: "We aren't buying energy cards." },
        ],
      }));
    }) as unknown as typeof fetch;
    const report = await buildBuylistReport(
      [
        { title: "Tatsugiri 186 - SV06 Twilight Masquerade Holofoil - Near Mint", variantId: "gid://shopify/ProductVariant/111", quantity: 2, marketValue: 23.5, tier: "Master" },
        { title: "Pidgey 1 - Base - Near Mint", variantId: "gid://shopify/ProductVariant/999", quantity: 3, marketValue: 1, tier: "Poke" },
      ],
      fetcher,
    );
    expect(asked).toEqual(["111,999"]);
    expect(report.source).toBe("card-broker");
    expect(report.cash).toBe(30.56);
    expect(report.credit).toBe(36.68);
    expect(report.retail).toBe(48);
    expect(report.copies).toBe(5);
    expect(report.matchedCopies).toBe(2);
    expect(report.missing).toEqual([{ title: "Pidgey 1 - Base - Near Mint", quantity: 3, marketValue: 1 }]);
    expect(report.byTier.Master).toEqual({ copies: 2, cash: 30.56, market: 47 });
  });

  it("asks for at most 100 variants at a time", async () => {
    const sizes: number[] = [];
    const fetcher = (async (url: string) => {
      sizes.push((new URL(url).searchParams.get("variants") ?? "").split(",").length);
      return new Response(JSON.stringify({ offers: [] }));
    }) as unknown as typeof fetch;
    const cards = Array.from({ length: 250 }, (_, i) => ({ title: `Card ${i}`, variantId: `gid://shopify/ProductVariant/${i + 1}`, quantity: 1, marketValue: 1, tier: "Poke" }));
    await buildBuylistReport(cards, fetcher);
    expect(sizes).toEqual([100, 100, 50]);
  });
});
