import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loader } from "../routes/proxy.api.shopper-market";
const f = vi.hoisted(() => ({
  proxy: vi.fn(),
  gql: vi.fn(),
  find: vi.fn(),
  unpack: vi.fn(),
  market: vi.fn(),
}));
vi.mock("../lib/proxy.server", () => ({
  proxyContext: f.proxy,
  json: (body: unknown, status = 200) => Response.json(body, { status }),
}));
vi.mock("../lib/orders.server", () => ({ gql: f.gql }));
vi.mock("../db.server", () => ({
  default: { cardbitDemoAccount: { findUnique: f.find } },
}));
vi.mock("../workspace/demo-catalog.server", () => ({ unpack: f.unpack }));
vi.mock("../workspace/vault-market.server", () => ({
  vaultMarketHistory: f.market,
}));
const shop = "hhuuev-81.myshopify.com",
  id = "gid://shopify/Customer/7";
const args = {
  request: new Request(
    "https://example.test/apps/packs/api/shopper-market?ids=999&customerId=888",
  ),
  url: new URL("https://example.test/apps/packs/api/shopper-market"),
  pattern: "/api/shopper-market",
  params: {},
  context: {},
};
const state = {
  v: 1,
  version: "set",
  copies: [
    { cardId: "A", status: "held" },
    { cardId: "B", status: "shipping" },
  ],
};
beforeEach(() => {
  vi.stubEnv("CARDBIT_STOREFRONT_SHOP", shop);
  vi.stubEnv("CARDBIT_TCGPLAYER_MARKET_APPROVED", "true");
  f.proxy.mockResolvedValue({
    shop,
    session: { shop },
    admin: {},
    viewer: { customerId: id },
  });
  f.gql.mockResolvedValue({
    customer: {
      id,
      tags: ["cardbit-demo-shopper"],
      seed: { jsonValue: state },
      catalog: { jsonValue: { version: "set" } },
    },
  });
  f.find.mockResolvedValue({ state });
  f.unpack.mockReturnValue({
    cards: ["A", "B", "C"].map((c, i) => ({
      id: c,
      tcgplayerId: i + 1,
      language: "en",
      printing: "Holofoil",
      condition: "Near Mint",
    })),
  });
  f.market.mockResolvedValue({});
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
it("queries only the signed customer's held printings", async () => {
  expect((await loader(args)).status).toBe(200);
  expect(f.find).toHaveBeenCalledWith({
    where: { shop_customerId: { shop, customerId: id } },
    select: { state: true },
  });
  expect(f.market).toHaveBeenCalledWith(["1|en|holofoil|near mint"]);
});
it("does not query history for a guest", async () => {
  f.proxy.mockResolvedValue({
    shop,
    session: { shop },
    admin: {},
    viewer: null,
  });
  expect((await loader(args)).status).toBe(401);
  expect(f.market).not.toHaveBeenCalled();
});
it("requires a designated preview owner", async () => {
  f.gql.mockResolvedValue({
    customer: {
      id,
      tags: [],
      seed: { jsonValue: state },
      catalog: { jsonValue: { version: "set" } },
    },
  });
  expect((await loader(args)).status).toBe(404);
  expect(f.find).not.toHaveBeenCalled();
});
