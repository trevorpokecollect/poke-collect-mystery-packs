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
    const rulesHtml = await page2.text();
    expect(rulesHtml).not.toMatch(/Counsel|NOT IN EFFECT/);
    // Rules page wears the site header and footer, and uses the support address.
    expect(rulesHtml).toContain('class="cb-nav"');
    expect(rulesHtml).toContain('class="cb-footer"');
    expect(rulesHtml).not.toContain("hello@cardbit.com");
    // Welcome Rewards + Daily Giveaway are wired to the site APIs.
    const home = await (await splat(args("")) as Response).text();
    expect(home).toContain('data-endpoint="/api/giveaway"');
    expect(home).toContain('data-cardbit-welcome data-endpoint="/api/welcome"');
    expect(home).not.toContain("cbg-referral");
    // Live Pulls presentation layer (flip-in, tier glows, Big Hit spotlight, Biggest Hit Today).
    expect(home).toMatch(/<script src="\/site\/js\/cardbit-site-live-pulls\.js\?v=\w+" data-back="\/site\/assets\/cardbit-card-back-en\.webp\?v=\w+" defer>/);
    expect(home).toContain("/site/css/cardbit-site-live-pulls.css?v=");
    for (const path of ["open/cobalt", "welcome"]) expect((await splat(args(path)) as Response).status).toBe(200);
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
    // Audit fixes: no "Back Unverified" wording, 0 wallet when signed out, eager first grid rows.
    expect(js).toContain("(site() ? '' : '<small>'");
    expect(js).toContain("site() && state && !account() ? 0");
    expect(js).toContain("site() && index<15");
    const how = readFileSync("public/site/assets/cardbit-how-it-works.js", "utf8");
    expect(how).toContain("/* SITE */ const sweep");
    const tools = readFileSync("public/site/assets/cardbit-collector-tools.js", "utf8");
    expect(tools).toContain("art(c,/* SITE */ index<15)");
    // Ship Together sends a real address and pays the fee in Cardbits; excluded states can't be picked.
    expect(tools).toContain("action:'ship-group',copyIds:item.copyIds,address:item.address,method:'CARDBITS'");
    expect(tools).toContain("const EXCLUDED = ['AL','HI','ID','MN','NV','NY','UT','WA'];");
    expect(tools).toContain("SHIP_FEE_BITS = 600, FREE_CARDS = 30, FREE_VALUE = 10000");
    expect(tools).toContain("const freeShip = (n, v) => n >= FREE_CARDS || v >= FREE_VALUE;");
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
    // Round 2: no pack tile tags, Vault market data from /api/portfolio, copy matches the free-shipping rule.
    expect(js).toContain("(site() ? '' : categoryTags(pack.id,true))");
    expect(readFileSync("public/site/assets/cardbit-collector-pages.js", "utf8")).toContain("root.CardbitSite?.marketLabel?.(c)");
    for (const f of ["how-it-works.html", "policies.html"]) expect(readFileSync("app/site/partials/" + f, "utf8")).not.toMatch(/more than 30 cards|over 30 cards/i);
  });
});

describe("link previews and reveal rewards", () => {
  it("puts a 1200x630 Open Graph and X card banner on every storefront page", () => {
    const html = storefrontShell({ title: "cardbit · Digital Packs, Real Cards" });
    expect(html).toContain('<meta property="og:image" content="https://cardbit.com/site/share/cardbit-share.png">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('<meta property="og:url" content="https://cardbit.com/">');
    for (const f of ["cardbit-share.png", "cardbit-share-cobalt.png", "cardbit-share-prism.png", "cardbit-share-gold.png", "cardbit-share-ember.png", "cardbit-share-amethyst.png"])
      expect(readFileSync(new URL("../../public/site/share/" + f, import.meta.url)).subarray(1, 4).toString()).toBe("PNG");
  });
  it("gives each pack its own preview", async () => {
    const { shareFor } = await import("./share.server");
    expect(shareFor("packs/cobalt", "x")).toMatchObject({ title: "Mystery Edition Pack · cardbit", image: "cardbit-share-cobalt.png", path: "/packs/cobalt" });
    expect(shareFor("packs/japanese-edition", "x")).toMatchObject({ image: "cardbit-share-ember.png" });
    expect(shareFor("shop", "Shop Singles · cardbit")).toMatchObject({ title: "Shop Singles · cardbit", image: "cardbit-share.png" });
  });
  it("shows XP and Sparks on the reveal, the Sparks pill, and modern backs for Japanese cards", () => {
    const opening = readFileSync(new URL("../../public/site/assets/cardbit-opening.js", import.meta.url), "utf8");
    const store = readFileSync(new URL("../../public/site/assets/cardbit-storefront.js", import.meta.url), "utf8");
    const media = readFileSync(new URL("../../public/site/assets/cardbit-card-media.js", import.meta.url), "utf8");
    expect(opening).toContain("options.onSpread");
    expect(store).toContain("window.CardbitRevealRewards?.node(o)");
    expect(store).toContain("sparksPill()");
    expect(media).toContain("if (root.CardbitStore?.site) return backs['ja-modern'];");
    expect(store).toContain("https://discord.gg/F9Z6jbgj4Y");
  });
  it("round 5: Live Pulls title, streak copy, icon-save flash, live level badge, player card, photo fallback, launcher image", () => {
    const store = readFileSync(new URL("../../public/site/assets/cardbit-storefront.js", import.meta.url), "utf8");
    expect(store).toContain("site() ? 'Live Pulls' : 'Just Pulled'");
    expect(store.match(/window\.CardbitPlayerPanel\.html\(pack\)/g)).toHaveLength(2);
    const rewards = readFileSync(new URL("../../public/site/assets/cardbit-rewards.js", import.meta.url), "utf8");
    expect(rewards).toContain("Each Day in a Row Makes Card Prizes on Your Daily Spins");
    expect(rewards).toContain("savedFlash(");
    expect(readFileSync(new URL("../../public/site/assets/cardbit-rewards-nav.js", import.meta.url), "utf8")).toContain("window.CardbitRewardsNav");
    const pulls = readFileSync(new URL("../../scripts/site/patches/live-pulls.js", import.meta.url), "utf8");
    expect(pulls).toContain("feedEligible({id:p.packId},{tier:p.tier})");
    const site = readFileSync(new URL("../../public/site/js/cardbit-site-store.js", import.meta.url), "utf8");
    expect(site).toContain("tcgplayer-cdn.tcgplayer.com/product/");
    expect(site).toContain("Photo Coming Soon");
    expect(site).toContain("window.CardbitPlayerPanel");
    const play = readFileSync(new URL("../../public/site/js/cardbit-site-play.js", import.meta.url), "utf8");
    expect(play).toContain("asset('icon-latch.webp')");
    expect(play).not.toContain("'cardbit-brand-emblem.png'");
  });

  it("Daily Rewards launcher: home page only, tier spin tiles, rules line, reduced motion", () => {
    const play = readFileSync(new URL("../../public/site/js/cardbit-site-play.js", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../public/site/css/cardbit-site-play.css", import.meta.url), "utf8");
    expect(play).toContain("const onHome = () => location.pathname === '/'");
    expect(play).toContain("if (!rw || !onHome())");
    expect(play).toContain("asset('spin-' + id + '.svg')");
    expect(play).toContain("No purchase necessary \\u00b7 <a href=\"/official-rules\">Official Rules</a>");
    for (const tier of ["bronze", "silver", "gold", "cobalt", "holo"]) expect(css).toContain(`.cb-lr-tile.tier-${tier}`);
    expect(css).toMatch(/prefers-reduced-motion:reduce\)\{\.cb-launch \*/);
  });
});
