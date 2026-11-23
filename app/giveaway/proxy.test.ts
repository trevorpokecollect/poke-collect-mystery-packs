import { beforeEach, it, expect, vi } from "vitest";
const { context, enter, consent, view, prompt } = vi.hoisted(() => ({
  context: vi.fn(),
  enter: vi.fn(),
  consent: vi.fn(),
  view: vi.fn(),
  prompt: vi.fn(),
}));
vi.mock("../lib/proxy.server", () => ({
  proxyContext: context,
  json: (v: unknown, status = 200) => Response.json(v, { status }),
}));
vi.mock("./entries.server", () => ({ enterOrBonus: enter }));
vi.mock("./consent.server", () => ({ subscribers: consent }));
vi.mock("./service.server", () => ({ customerView: view, promptView: prompt }));
vi.mock("../db.server", () => ({ default: {} }));
import { action, loader } from "../routes/proxy.api.giveaway";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
const id = "gid://shopify/Customer/123";
const url = "https://cardbit.com/apps/packs/api/giveaway";
const submit = (body: unknown, content = "application/json", path = url) =>
  action({
    request: new Request(path, {
      method: "POST",
      headers: { "Content-Type": content },
      body: JSON.stringify(body),
    }),
  } as Parameters<typeof action>[0]);
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CARDBIT_STOREFRONT_SHOP", shop);
  vi.stubEnv("CARDBIT_WORKSPACE_MODE", "test");
  vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "");
  context.mockResolvedValue({ shop, viewer: { customerId: id }, admin: {} });
  consent.mockResolvedValue(new Set([id]));
  view.mockResolvedValue({ entered: true });
});
it("denies other Shopify installs before recording an entry", async () => {
  context.mockResolvedValue({
    shop: "other.myshopify.com",
    viewer: { customerId: id },
    admin: {},
  });
  expect((await submit({ intent: "enter" })).status).toBe(404);
  expect(enter).not.toHaveBeenCalled();
});
it("reads prompt visibility without crediting an entry or requesting marketing consent", async () => {
  prompt.mockResolvedValue({ enabled: false });
  const response = await loader({
    request: new Request(url + "?view=prompt"),
  } as Parameters<typeof loader>[0]);
  expect(await response.json()).toEqual({ enabled: false });
  expect(enter).not.toHaveBeenCalled();
  expect(consent).not.toHaveBeenCalled();
});
it("returns the saved one-entry receipt only for the displayed draw and signed account", async () => {
  const day = "2026-11-23";
  const body = { intent: "enter", expectedDay: day };
  const target = url + "?view=prompt";
  expect(
    (await submit({ intent: "enter" }, "application/json", target)).status,
  ).toBe(400);
  expect(enter).not.toHaveBeenCalled();
  enter.mockResolvedValue({ day, entered: true, dailyEntries: 1 });
  const response = await submit(body, "application/json", target);
  expect(await response.json()).toEqual({
    day,
    entered: true,
    dailyEntries: 1,
  });
  expect(enter).toHaveBeenCalledWith({}, id, body);
  consent.mockResolvedValue(new Set());
  expect((await submit(body, "application/json", target)).status).toBe(403);
  expect(enter).toHaveBeenCalledTimes(1);
});
it("rejects guest order-token entry and a forged customer ID", async () => {
  context.mockResolvedValue({
    shop,
    viewer: { openToken: "order-link" },
    admin: {},
  });
  expect((await submit({ intent: "enter", customerId: id })).status).toBe(403);
  expect(enter).not.toHaveBeenCalled();
});
it("requires current email opt-in even if the browser sends consent true", async () => {
  consent.mockResolvedValue(new Set());
  expect((await submit({ intent: "enter", consent: true })).status).toBe(403);
  expect(enter).not.toHaveBeenCalled();
});
it("credits the signed-in user, independent of IDs or amounts in the browser", async () => {
  const body = { intent: "share", customerId: "another", entries: 100000 };
  expect((await submit(body)).ok).toBe(true);
  expect(enter).toHaveBeenCalledWith({}, id, body);
});
it("rejects form posts and upstream consent failure without a write", async () => {
  expect((await submit({ intent: "enter" }, "text/plain")).status).toBe(415);
  consent.mockRejectedValue(Error("Email subscription status is unavailable."));
  expect((await submit({ intent: "enter" })).ok).toBe(false);
  expect(enter).not.toHaveBeenCalled();
});
