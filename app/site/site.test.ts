import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loader as splat } from "../routes/$";
import { loader as policies } from "../routes/policies";
import { loader as rules } from "../routes/official-rules";
import { storefrontShell } from "./shell.server";
import manifest from "./assets-manifest.json";

const args = (path: string) =>
  ({ request: new Request(`http://site.test/${path}`), params: { "*": path }, context: {} }) as never;

afterEach(() => { delete process.env.CARDBIT_SITE; });

describe("Cardbit site pages", () => {
  it("stay off unless CARDBIT_SITE=on", async () => {
    expect((await splat(args("packs/mystery")) as Response).status).toBe(404);
    expect((await policies() as Response).status).toBe(404);
  });

  it("serve the storefront shell for known pages and 404 for unknown ones", async () => {
    process.env.CARDBIT_SITE = "on";
    const page = (await splat(args("vault"))) as Response;
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('id="cardbit-store"');
    expect((await splat(args("nope")) as Response).status).toBe(404);
    expect((await policies() as Response).status).toBe(200);
    const page2 = (await rules()) as Response;
    expect(page2.status).toBe(200);
    expect(await page2.text()).not.toMatch(/Counsel|NOT IN EFFECT/);
  });

  it("references only assets that exist, and never the Shopify-only stores", () => {
    const html = storefrontShell();
    for (const [, name] of html.matchAll(/\/site\/assets\/([^"?]+)/g)) {
      expect(Object.keys(manifest)).toContain(name);
    }
    expect(html).not.toMatch(/store-adapter|demo-shopper|cardbit-wallet\.js|stock-catalog|cdn\.shopify/);
    expect(html).toContain('<template id="cb-portable-how">');
    expect(html).not.toMatch(/pullFeed|data-pull-ticker/);
  });

  it("keeps the site patches in the vendored storefront", () => {
    const js = readFileSync("public/site/assets/cardbit-storefront.js", "utf8");
    expect(js).toContain("/* SITE */ const site =");
    expect(js).toContain("window.CardbitSite.topupURL(amount)");
    expect(js).not.toContain("/apps/packs/api/pool");
  });
});
