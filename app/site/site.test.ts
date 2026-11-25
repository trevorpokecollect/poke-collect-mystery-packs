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
    expect(js).toContain("navigate('ship-together/select/'+enc(id))");
    const tools = readFileSync("public/site/assets/cardbit-collector-tools.js", "utf8");
    // Ship Together sends a real address and pays the fee in Cardbits; excluded states can't be picked.
    expect(tools).toContain("action:'ship-group',copyIds:item.copyIds,address:item.address,method:'CARDBITS'");
    expect(tools).toContain("const EXCLUDED = ['AL','HI','ID','MN','NV','NY','UT','WA'];");
    expect(tools).toContain("SHIP_FEE_BITS = 600, FREE_OVER = 30");
    // Live Pulls card feed on home (no text ticker), plain footer Policies link.
    expect(js).toContain("window.CardbitSite.api('recent?limit=12')");
    expect(js).toContain("(site() ? pullFeed() : '')");
    expect(js).toContain("(site() ? '' : '<div class=\"cbf-ticker\"");
    expect(js).toContain("Policies</a>' : policyLink('Policies'))");
    // Holo follows the pack image; hero conveyor spacing, desktop column and Ship Home fixes.
    expect(readFileSync("public/site/assets/cardbit-flair.js", "utf8")).toContain("fitHolo(img, holo)");
    const hero = readFileSync("public/site/assets/cardbit-hero-scenes.js", "utf8");
    expect(hero).toContain("gap = (W + ph * 1.64) / count");
    expect(hero).toContain("colL, colR");
    expect(hero).toContain("SITE: the card sinks into an open box");
  });
});
