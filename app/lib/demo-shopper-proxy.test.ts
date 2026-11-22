import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  proxy: vi.fn(),
  gql: vi.fn(),
  db: {},
  account: vi.fn(),
}));
vi.mock("../db.server", () => ({ default: mocks.db }));
vi.mock("../lib/proxy.server", () => ({
  proxyContext: mocks.proxy,
  json: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock("../lib/orders.server", () => ({ gql: mocks.gql }));
import { loader, action } from "../routes/proxy.api.shopper";
import { CARDBIT_SHOP } from "../lib/cardbit.server";
const viewer = { customerId: "gid://shopify/Customer/100" };
function args(url: string, post = false) {
  return {
    request: new Request(
      url,
      post
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "topup",
              proof: "wrong",
              amount: 100,
            }),
          }
        : {},
    ),
    params: {},
    context: {},
  } as Parameters<typeof loader>[0];
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CARDBIT_STOREFRONT_SHOP", CARDBIT_SHOP);
  mocks.proxy.mockResolvedValue({
    shop: CARDBIT_SHOP,
    session: { shop: CARDBIT_SHOP },
    admin: {},
    viewer,
  });
});
it("denies unsigned-in and order-link-only sessions before loading customer records", async () => {
  mocks.proxy.mockResolvedValue({
    shop: CARDBIT_SHOP,
    session: { shop: CARDBIT_SHOP },
    admin: {},
    viewer: { openToken: "test" },
  });
  expect(
    (await loader(args("https://example.test/proxy?customerId=100"))).status,
  ).toBe(401);
  expect(mocks.gql).not.toHaveBeenCalled();
});
it("denies a different store and checks the signed customer, ignoring client-specified owners", async () => {
  mocks.proxy.mockResolvedValueOnce({
    shop: "other",
    session: { shop: "other" },
    admin: {},
    viewer,
  });
  expect((await loader(args("https://example.test/proxy"))).status).toBe(404);
  mocks.gql.mockResolvedValue({ customer: { id: viewer.customerId } });
  expect(
    (await loader(args("https://example.test/proxy?customerId=999"))).status,
  ).toBe(404);
  expect(mocks.gql.mock.calls[0][2]).toEqual({ id: viewer.customerId });
});
it("rejects unconfirmed writes before fetching or changing an account", async () => {
  expect((await action(args("https://example.test/proxy", true))).status).toBe(
    403,
  );
  expect(mocks.gql).not.toHaveBeenCalled();
});
