import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
const mocks = vi.hoisted(() => ({
  sets: vi.fn(),
  gql: vi.fn(),
  read: vi.fn(),
  change: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("../lib/orders.server", () => ({ gql: mocks.gql }));
vi.mock("./book.server", () => ({
  readBook: mocks.read,
  changeBook: mocks.change,
}));
vi.mock("./market-chart.server", async (original) => ({
  ...(await original<typeof import("./market-chart.server")>()),
  japaneseSetMarkets: mocks.sets,
}));
import { refresh } from "./sources.server";
import { lookup, verifyAccount } from "./customers.server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
const db = {} as PrismaClient,
  admin = {} as AdminApiContext;
const shopifyVariant = "gid://shopify/ProductVariant/501",
  product = "gid://shopify/Product/81";
const refKey = "101|ja|holo|near mint";
const printing = {
  tcgplayerId: 101,
  name: "Test printing",
  number: "13",
  language: "ja",
  printing: "Holo",
  set: { name: "Test Set" },
  market: { market: "2.25", marketAsOf: "2026-11-22", fetchedAt: "2026-11-23" },
};
const snapshot = {
  date: "2026-11-22",
  cards: [
    {
      id: "101",
      name: "Test printing",
      no: "13",
      set: "Test Set",
      finish: "Holo",
      condition: "Near Mint",
      language: "Japanese",
      retail: 325,
      cash: 125,
    },
  ],
};
const mapping = {
  tcgplayerId: "101",
  language: "Japanese",
  printing: "Holo",
  condition: "Near Mint",
  merchantVariantId: "881",
};
function wire(
  opts: {
    own?: boolean;
    hasSnapshot?: boolean;
    links?: unknown[];
    offer?: {
      cash: number | null;
      retail: number | null;
      hiddenBy?: string;
      unavailable?: string;
    };
    marketField?: boolean;
    otherShop?: boolean;
    english?: string;
    soldOut?: boolean;
  } = {},
) {
  const base = opts.english ? { ...printing, language: "en" } : printing;
  const c =
    opts.marketField === false ? { ...base, market: undefined } : base;
  mocks.gql.mockImplementation(async (_admin: unknown, document: string) => {
    if (document.includes("JapaneseShopperCatalogs"))
      return { customers: { nodes: [], pageInfo: { hasNextPage: false } } };
    if (document.includes("WorkspaceVariantOwnership"))
      return {
        shop: { myshopifyDomain: shop },
        nodes:
          opts.own === false
            ? [null]
            : [
                {
                  id: shopifyVariant,
                  price: opts.english ?? "4.00",
                  product: {
                    id: product,
                    productType: "Pokemon Japanese Single",
                  },
                },
              ],
      };
    return {
      shop: {
        myshopifyDomain: opts.otherShop ? "other.myshopify.com" : shop,
        reference: opts.hasSnapshot === false ? null : { jsonValue: snapshot },
        catalog: null,
        links: { jsonValue: opts.links ?? [mapping] },
      },
    };
  });
  mocks.fetch.mockImplementation(async (raw: string, init: RequestInit) => {
    const u = new URL(raw);
    if (u.hostname === "poke-collect.com") {
      if (u.pathname === "/apps/buylist/singles/offer") {
        expect(u.searchParams.get("tcgplayerId")).toBe("101");
        return Response.json({
          tcgplayerId: 101,
          setName: "Test Set",
          number: "13",
          printing: "Holo",
          condition: "Near Mint",
          cash: 1.25,
        });
      }
      expect(u.pathname).toBe("/apps/buylist/singles/variant-offers");
      expect(u.searchParams.get("variants")).toBe("881");
      expect(new Headers(init.headers).has("Authorization")).toBe(false);
      return Response.json({
        source: "card-broker",
        offers: [
          { variantId: "881", ...(opts.offer ?? { cash: 1.55, retail: 3.45 }) },
        ],
      });
    }
    expect(u.origin).toBe("https://app.cardbroker.app");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer test-only",
    );
    const pages: Record<string, unknown> = {
      inventory: {
        items: opts.soldOut ? [] : [
          {
            variantId: "501",
            productId: "81",
            condition: "Near Mint",
            card: c,
          },
        ],
      },
      sets: { items: [{ id: "test", name: "Test Set" }] },
      cards: {
        items: opts.english
          ? [c, { ...c, language: "ja" }]
          : [{ ...c, language: "en", market: { market: "999.00" } }, c],
      },
    };
    expect(u.pathname.startsWith("/api/v1/")).toBe(true);
    return Response.json(pages[u.pathname.split("/").pop()!]);
  });
  mocks.read.mockResolvedValue({ refs: {} });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.sets.mockResolvedValue(new Map());
  vi.stubEnv("CARD_BROKER_API_KEY", "test-only");
  vi.stubEnv("CARD_BROKER_API_URL", "https://app.cardbroker.app/api/v1");
  vi.stubEnv("CARDBIT_TCGPLAYER_MARKET_APPROVED", "false");
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("works with the existing catalog/inventory key and checks merchant cash with the merchant variant ID", async () => {
  wire({ hasSnapshot: false, marketField: false });
  await refresh(db, admin);
  const change = mocks.change.mock.calls[0][1];
  expect(change.refs[refKey]).toMatchObject({
    retail: 345,
    cash: 155,
    market: null,
    quoteSource: "merchant",
  });
  expect(change.variants).toEqual({ [shopifyVariant]: refKey });
});
it("requires an authenticated Cardbit store and actual Cardbit product/variant ownership", async () => {
  wire({ otherShop: true });
  await expect(refresh(db, admin)).rejects.toThrow("Wrong store");
  expect(mocks.fetch).not.toHaveBeenCalled();
  wire({ own: false });
  await expect(refresh(db, admin)).rejects.toThrow("does not match");
  expect(mocks.change).not.toHaveBeenCalled();
});
it("preserves a dated planning reference without using Cardbit variant IDs on the merchant endpoint", async () => {
  wire({ links: [] });
  await refresh(db, admin);
  expect(mocks.change.mock.calls[0][1].refs[refKey]).toMatchObject({
    quoteSource: "snapshot",
    retail: 325,
    cash: 125,
    market: null,
    retailDate: "2026-11-22",
  });
  expect(
    mocks.fetch.mock.calls.every(
      ([url]) => new URL(url).hostname !== "poke-collect.com",
    ),
  ).toBe(true);
});
it("keeps a hidden cash offer ineligible and applies only the exact approved market printing", async () => {
  vi.stubEnv("CARDBIT_TCGPLAYER_MARKET_APPROVED", "true");
  wire({ offer: { cash: 1.79, retail: 5.25, hiddenBy: "stock rules" } });
  await refresh(db, admin);
  expect(mocks.change.mock.calls[0][1].refs[refKey]).toMatchObject({
    cash: null,
    market: 225,
    retail: 525,
  });
});
it("rejects conflicting merchant identities before requesting prices", async () => {
  wire({ links: [mapping, { ...mapping, language: "English" }] });
  await expect(refresh(db, admin)).rejects.toThrow("conflicting");
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it("keeps unmapped inventory unpriced when the planning snapshot is absent", async () => {
  wire({ links: [], hasSnapshot: false });
  await refresh(db, admin);
  expect(mocks.change.mock.calls[0][1].refs[refKey]).toMatchObject({
    retail: null,
    cash: null,
    market: null,
    quoteSource: "unmatched",
  });
});
it("requires a matching Shopify customer before an owner opens a new wallet", async () => {
  const id = "gid://shopify/Customer/123";
  mocks.gql.mockResolvedValue({ customer: null });
  await expect(verifyAccount(admin, id, "wallet")).rejects.toThrow("Cardbit");
  mocks.gql.mockResolvedValue({
    customers: {
      nodes: [
        { id, displayName: "Test collector", email: "different@example.test" },
      ],
    },
  });
  await expect(lookup(db, admin, "collector@example.test")).rejects.toThrow(
    "No Cardbit customer",
  );
  mocks.gql.mockResolvedValue({
    customer: {
      id,
      displayName: "Test collector",
      email: "collector@example.test",
    },
  });
  const empty = {
    cardbitDemoAccount: { findUnique: async () => null },
  } as unknown as PrismaClient;
  expect(await lookup(empty, admin, "123")).toMatchObject({
    source: "wallet",
    customerId: id,
  });
});

it("checks the exact Japanese printing directly when the merchant variant map omits it", async () => {
  vi.stubEnv("CARDBIT_TCGPLAYER_MARKET_APPROVED", "true");
  wire({ links: [], hasSnapshot: false });
  await refresh(db, admin);
  expect(mocks.change.mock.calls[0][1].refs[refKey]).toMatchObject({
    cash: 125,
    market: 225,
    retail: 270,
    quoteSource: "merchant",
  });
});

it.each([true, false])(
  "uses the same Japanese Market quote as the storefront with a catalog quote present=%s",
  async (marketField) => {
    vi.stubEnv("CARDBIT_TCGPLAYER_MARKET_APPROVED", "true");
    wire({ links: [], marketField, hasSnapshot: false });
    mocks.sets.mockResolvedValue(
      new Map([[JSON.stringify(["Test Set", "101", "13", "holo"]), "1.27"]]),
    );
    await refresh(db, admin);
    expect(mocks.sets).toHaveBeenCalledWith(new Set(["Test Set"]));
    expect(mocks.change.mock.calls[0][1].refs[refKey]).toMatchObject({
      cash: 125,
      market: 127,
      retail: 152,
      quoteSource: "merchant",
    });
  },
);

it("prices listed English singles from Poke-Collect's printing buylist without a merchant variant map", async () => {
  wire({ links: [], hasSnapshot: false, english: "3.10" });
  await refresh(db, admin);
  expect(mocks.change.mock.calls[0][1].refs["101|en|holo|near mint"]).toMatchObject({
    cash: 125,
    retail: 310,
    quoteSource: "merchant",
  });
  expect(mocks.change.mock.calls[0][1].variants[shopifyVariant]).toBe("101|en|holo|near mint");
});

it("keeps the last listing retail and its date for an English printing after it sells out", async () => {
  const key = "101|en|holo|near mint";
  wire({ links: [], hasSnapshot: false, english: "3.10", soldOut: true });
  mocks.read.mockResolvedValue({
    refs: {
      [key]: {
        key, name: "Test printing", set: "Test Set", number: "13", language: "English",
        finish: "Holo", condition: "Near Mint", retail: 310, cash: 100, market: null,
        quoteSource: "merchant", retailDate: "2026-11-20", marketDate: null,
      },
    },
  });
  await refresh(db, admin);
  expect(mocks.change.mock.calls[0][1].refs[key]).toMatchObject({
    cash: 125,
    retail: 310,
    retailDate: "2026-11-20",
    quoteSource: "merchant",
  });
});
