import { describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import Pricing, { type Catalog } from "./calculator.mjs";
import { loadCatalog, unpackCatalog } from "./catalog.server";
import { saveScenario } from "./scenario.server";

const card = {
  key: "printing",
  id: "12",
  name: "Test card",
  no: "01",
  set: "Set A",
  finish: "Holofoil",
  condition: "Near Mint",
  market: 90,
  retail: 100,
  cash: 25,
  credit: 30,
  value: 80,
  buyback: 80,
};
const pool = {
  id: "sample",
  title: "Test series",
  price: 100,
  draws: 1,
  pricing: {
    basis: "poke-collect-retail" as const,
    targetBps: 10000,
    buybackBps: 8000,
  },
  rows: [{ i: 0, qty: 3, tier: "Common" }],
};
const catalog: Catalog = {
  version: "test-version",
  date: "2026-11-22",
  cards: [card],
  pools: [pool],
};
const bundle = (data: unknown) => {
  const bytes = Buffer.from(JSON.stringify(data));
  return {
    data: gzipSync(bytes).toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};
function adminWith(record: unknown, error?: string) {
  const graphql = vi.fn(async (query: string) =>
    Response.json({
      data: query.includes("mutation")
        ? {
            metafieldsSet: {
              metafields: error
                ? []
                : [{ compareDigest: "new", updatedAt: "now" }],
              userErrors: error ? [{ code: error }] : [],
            },
          }
        : {
            currentAppInstallation: {
              id: "gid://shopify/AppInstallation/1",
              metafield: record,
            },
          },
    }),
  );
  return { graphql, admin: { graphql } as unknown as AdminApiContext };
}
describe("Cardbit staff pricing", () => {
  it("unpacks only a verified catalog of actively quoted printings", () => {
    expect(unpackCatalog(bundle(catalog))).toEqual(catalog);
    expect(unpackCatalog(null)).toBeNull();
    expect(() =>
      unpackCatalog({ ...bundle(catalog), sha256: "other" }),
    ).toThrow();
    expect(() =>
      unpackCatalog(bundle({ ...catalog, cards: [{ ...card, cash: 0 }] })),
    ).toThrow();
    expect(() =>
      unpackCatalog(
        bundle({ ...catalog, cards: [{ ...card, key: "constructor" }] }),
      ),
    ).toThrow();
  });
  it("weights physical copies, keeps both acquisition bases and locks eligibility", () => {
    const c = {
      ...catalog,
      cards: [card, { ...card, key: "b", retail: 201 }],
      pools: [
        {
          ...pool,
          rows: [
            { i: 0, qty: 3, tier: "A" },
            { i: 1, qty: 1, tier: "B" },
          ],
        },
      ],
    };
    const p = c.pools[0],
      draft = Pricing.empty(c.version);
    const total = Pricing.poolSummary(p, c.cards, draft);
    expect(total.total).toMatchObject({
      market: 501,
      cash: 100,
      credit: 120,
      offer: 401,
    });
    expect(total.ev).toMatchObject({ market: 125.25, offer: 100.25 });
    draft.pools.sample = {
      bands: [
        { set: "Set A", min: 100, max: 201, bps: 7500 },
        { set: "", min: 0, max: null, bps: 5000 },
      ],
    };
    expect(Pricing.poolSummary(p, c.cards, draft).total.offer).toBe(326);
    draft.cards.printing = {
      buyback: { mode: "retail", bps: 9500, coverage: "quoted" },
    };
    expect(Pricing.poolSummary(p, c.cards, draft).total.offer).toBe(386);
    const ineligible = { ...card, cash: null };
    expect(
      Pricing.cardQuote(ineligible, draft, Pricing.properties(p, draft)).offer,
    ).toBeNull();
    expect(
      Pricing.poolSummary({ ...p, draws: 5 }, c.cards, draft).ev.market,
    ).toBeNull();
    expect(Pricing.validate({ ...draft, cards: { foreign: {} } }, c)).toBe(
      false,
    );
  });
  it("refreshes actual variant quotes only for a tenant-owned series, and omits loose remaining slots", async () => {
    const db = {
      series: {
        findFirst: vi.fn(async () => ({
          id: "pool",
          title: "Series",
          status: "LIVE",
          cardsPerPack: 2,
          packPrice: 10,
          cards: [
            {
              id: "a",
              variantId: "gid://shopify/ProductVariant/1",
              title: "A",
              tier: "A",
              quantity: 9,
            },
            {
              id: "b",
              variantId: "gid://shopify/ProductVariant/2",
              title: "B",
              tier: "A",
              quantity: 9,
            },
          ],
        })),
      },
      slot: {
        findMany: vi.fn(async () => [
          { cardId: "a" },
          { cardId: "b" },
          { cardId: "a" },
        ]),
      },
    };
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        offers: [
          { variantId: "1", retail: 3, cash: 1, credit: 1.25 },
          {
            variantId: "2",
            retail: 4,
            cash: 0.5,
            credit: 1,
            hiddenBy: "buylist rule",
          },
        ],
      }),
    );
    try {
      const result = await loadCatalog(
        db as never,
        {} as never,
        "store",
        "pool",
      );
      expect(db.series.findFirst.mock.calls[0]).toEqual([
        expect.objectContaining({
          where: { id: "pool", shop: "store", storePurchase: false },
        }),
      ]);
      expect(db.slot.findMany.mock.calls[0]).toEqual([
        expect.objectContaining({
          where: {
            seriesId: "pool",
            claimed: false,
            voided: false,
            position: { not: null },
          },
        }),
      ]);
      expect(result.catalog?.pools[0].rows.map((r) => r.qty)).toEqual([1, 1]);
      expect(result.catalog?.cards.map((c) => c.buyback)).toEqual([240, null]);
      expect(f).toHaveBeenCalledTimes(1);
    } finally {
      f.mockRestore();
    }
  });
  it("rejects a foreign shop catalog and a series outside the authenticated shop", async () => {
    const db = { series: { findFirst: async () => null } };
    await expect(
      loadCatalog(db as never, {} as never, "ours", "other"),
    ).rejects.toMatchObject({ status: 404 });
    const admin = {
      graphql: async () =>
        Response.json({ data: { shop: { myshopifyDomain: "other" } } }),
    };
    await expect(
      loadCatalog(db as never, admin as never, "ours", null),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("guards first creation and never overwrites a stale version", async () => {
    const d = Pricing.empty(catalog.version);
    const first = adminWith(null);
    expect(await saveScenario(first.admin, catalog, d, null)).toMatchObject({
      ok: true,
    });
    expect(first.graphql.mock.calls[1]).toEqual([
      expect.any(String),
      {
        variables: {
          fields: [
            expect.objectContaining({
              ownerId: "gid://shopify/AppInstallation/1",
              compareDigest: null,
            }),
          ],
        },
      },
    ]);
    const changed = adminWith({
      jsonValue: d,
      compareDigest: "other",
      updatedAt: "then",
    });
    expect(
      await saveScenario(
        changed.admin,
        catalog,
        { ...d, pools: { sample: { price: 200 } } },
        "a",
      ),
    ).toMatchObject({ ok: false });
    expect(changed.graphql).toHaveBeenCalledTimes(1);
    expect(await saveScenario(changed.admin, catalog, d, "old")).toMatchObject({
      ok: true,
      digest: "other",
    });
    const race = adminWith(null, "STALE_OBJECT");
    expect(await saveScenario(race.admin, catalog, d, null)).toMatchObject({
      ok: false,
    });
  });
});
