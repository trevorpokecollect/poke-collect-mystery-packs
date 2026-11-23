import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  proxy: vi.fn(),
  vault: vi.fn(),
  admin: vi.fn(),
}));
vi.mock("../lib/proxy.server", () => ({
  proxyContext: mock.proxy,
  json: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock("./portfolio.server", () => ({ vault: mock.vault }));
vi.mock("../shopify.server", () => ({
  unauthenticated: { admin: mock.admin },
}));
vi.mock("../db.server", () => ({ default: {} }));
import { loader } from "../routes/proxy.api.portfolio";
import { action } from "../routes/internal.cardbit-workspace";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
const url = "https://cardbit.test/proxy?customerId=forged";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CARDBIT_STOREFRONT_SHOP", shop);
  vi.stubEnv("CARDBIT_WORKSPACE_MODE", "test");
});
it("derives vault ownership from the signed session and omits acquisition data", async () => {
  mock.proxy.mockResolvedValue({
    shop,
    session: { shop },
    admin: {},
    viewer: { customerId: "gid://shopify/Customer/123" },
  });
  mock.vault.mockResolvedValue({
    holdings: [
      {
        name: "A",
        key: "id",
        qty: 1,
        bits: 400,
        market: 500,
        cash: 100,
        retail: 490,
      },
    ],
  });
  const res = await loader({ request: new Request(url) } as Parameters<
    typeof loader
  >[0]);
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(mock.vault.mock.calls[0].slice(2)).toEqual([
    "gid://shopify/Customer/123",
    "wallet",
  ]);
  expect(body.holdings[0]).not.toHaveProperty("cash");
  expect(body.holdings[0]).not.toHaveProperty("retail");
});
it("denies other installs, disabled workspaces and order tokens without a signed-in customer", async () => {
  const req = { request: new Request(url) } as Parameters<typeof loader>[0];
  mock.proxy.mockResolvedValue({
    shop,
    session: { shop },
    admin: {},
    viewer: { openToken: "private" },
  });
  expect((await loader(req)).status).toBe(401);
  mock.proxy.mockResolvedValue({
    shop: "other",
    session: { shop: "other" },
    viewer: { customerId: "1" },
  });
  expect((await loader(req)).status).toBe(404);
  expect(mock.vault).not.toHaveBeenCalled();
});
it("denies the bridge before making any Shopify request without both installed secrets and the configured owner", async () => {
  vi.stubEnv("CARDBIT_DESK_SECRET", "x".repeat(40));
  vi.stubEnv("CARDBIT_OWNER_STAFF_ID", "trevor-test");
  vi.stubEnv("CARDBIT_OWNER_EMAIL", "owner@example.test");
  const req = (headers: Record<string, string>) =>
    ({
      request: new Request("https://example.test/internal/cardbit-workspace", {
        method: "POST",
        headers: { "x-cardbit-owner-email": "owner@example.test", ...headers },
        body: '{"action":"home"}',
      }),
    }) as Parameters<typeof action>[0];
  for (const headers of [
    {
      Authorization: "Bearer wrong",
      "x-cardbit-owner": "trevor-test",
      "x-cardbit-shop": shop,
    },
    {
      Authorization: "Bearer " + "x".repeat(40),
      "x-cardbit-owner": "other",
      "x-cardbit-shop": shop,
    },
    {
      Authorization: "Bearer " + "x".repeat(40),
      "x-cardbit-owner": "trevor-test",
      "x-cardbit-shop": "other",
    },
  ])
    expect((await action(req(headers))).status).toBe(403);
  expect(mock.admin).not.toHaveBeenCalled();
});
it("accepts the signed staging owner without a production staff ID and blocks the shared live service", async () => {
  const key = "a".repeat(40);
  vi.stubEnv("CARDBIT_OWNER_STAFF_ID", "");
  vi.stubEnv("CARDBIT_OWNER_EMAIL", "owner@example.test");
  vi.stubEnv("CARDBIT_DESK_SECRET", key);
  vi.stubEnv("RAILWAY_PROJECT_NAME", "cardbit-test");
  vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "staging");
  mock.admin.mockResolvedValue({ session: { shop }, admin: {} });
  const req = (email = "owner@example.test") =>
    ({
      request: new Request(
        "https://packs.example.test/internal/cardbit-workspace",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "x-cardbit-owner": "staging-owner",
            "x-cardbit-owner-email": email,
            "x-cardbit-shop": shop,
          },
          body: JSON.stringify({ action: "unknown" }),
        },
      ),
    }) as Parameters<typeof action>[0];
  expect((await action(req("other@example.test"))).status).toBe(403);
  expect((await action(req())).status).toBe(400);
  expect(mock.admin).toHaveBeenCalledTimes(1);
  vi.stubEnv("RAILWAY_PROJECT_NAME", "cardbit-mystery-packs");
  vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
  expect((await action(req())).status).toBe(403);
  expect(mock.admin).toHaveBeenCalledTimes(1);
});
