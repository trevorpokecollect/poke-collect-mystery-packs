import { afterEach, expect, it, vi } from "vitest";
const { auth, series, catalog, load, save } = vi.hoisted(() => ({
  auth: vi.fn(),
  series: vi.fn(),
  catalog: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
}));
vi.mock("../shopify.server", () => ({ authenticate: { admin: auth } }));
vi.mock("../db.server", () => ({ default: {} }));
vi.mock("./catalog.server", () => ({
  deskSeries: series,
  loadCatalog: catalog,
}));
vi.mock("./scenario.server", () => ({
  loadScenario: load,
  saveScenario: save,
}));
import { loader, action } from "../routes/app.pricing-desk";
const shop = "hhuuev-81.myshopify.com";
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
it("requires the staff admin session on both entry points", async () => {
  auth.mockRejectedValue(new Response("Sign in", { status: 401 }));
  const args = { request: new Request("https://app.test/app/pricing-desk") };
  for (const handler of [loader, action])
    await expect(handler(args as never)).rejects.toMatchObject({ status: 401 });
  expect(catalog).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
it("hides the desk from another shop and from an unconfigured Cardbit install", async () => {
  vi.stubEnv("CARDBIT_STOREFRONT_SHOP", shop);
  auth.mockResolvedValue({ session: { shop: "other.myshopify.com" } });
  const args = {
    request: new Request("https://app.test/app/pricing-desk?shop=" + shop),
  };
  for (const handler of [loader, action])
    await expect(handler(args as never)).rejects.toMatchObject({ status: 404 });
  auth.mockResolvedValue({ session: { shop } });
  vi.stubEnv("CARDBIT_STOREFRONT_SHOP", "");
  await expect(loader(args as never)).rejects.toMatchObject({ status: 404 });
  expect(series).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
it("scopes reads to the authenticated Cardbit installation and keeps empty sources usable", async () => {
  vi.stubEnv("CARDBIT_STOREFRONT_SHOP", shop);
  auth.mockResolvedValue({ session: { shop }, admin: {} });
  series.mockResolvedValue([]);
  catalog.mockResolvedValue({ catalog: null, notice: "No catalog" });
  const result = await loader({
    request: new Request("https://app.test/app/pricing-desk?series=owned"),
  } as never);
  expect(result.data).toMatchObject({
    source: "owned",
    saved: null,
    series: [],
  });
  expect(catalog).toHaveBeenCalledWith({}, {}, shop, "owned");
  expect(load).not.toHaveBeenCalled();
});
