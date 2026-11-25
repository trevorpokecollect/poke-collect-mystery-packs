#!/usr/bin/env node
/*
 * Ports the approved Cardbit Dark theme (private repo trevorpokecollect/cardbit-theme) into the
 * standalone site. Re-run after an approved theme change so the site stays in step:
 *
 *   npm i --no-save liquidjs@10
 *   node scripts/site/port-theme.mjs /path/to/cardbit-theme
 *
 * Inputs (theme): main (hero scenes, policies) merged with branch cardbit-how-it-works-live.
 * Outputs:
 *   public/site/assets/*        theme cardbit-* files, minus Shopify-only scripts, with SITE patches
 *   app/site/partials/*.html    How It Works template, Policies body, Official Rules body
 *
 * Every patch asserts its anchor exists, so a theme change that moves code fails loudly here
 * instead of shipping a silently unpatched storefront.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const theme = process.argv[2];
if (!theme || !existsSync(join(theme, 'assets/cardbit-storefront.js'))) {
  console.error('usage: node scripts/site/port-theme.mjs /path/to/cardbit-theme');
  process.exit(1);
}
const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');
const outAssets = join(repo, 'public/site/assets');
const outPartials = join(repo, 'app/site/partials');

// Shopify-only or fixture files the site does not load.
const SKIP = new Set([
  'cardbit-store-adapter.js',   // IndexedDB rehearsal store; replaced by cardbit-site-store.js
  'cardbit-demo-shopper.js',    // Shopify member session store; replaced by cardbit-site-store.js
  'cardbit-stock-catalog.js',   // Shopify draft inventory snapshot (test fixtures)
  'cardbit-retail.js',          // static retail map; the site API sends retailBits per card
  'cardbit-modern-pools.js',    // Shopify-theme pool manifest
  'cardbit-mystery-pool.js',    // Shopify pool snapshot fallback
  'cardbit-wallet.js',          // Shopify cart top-ups
  'cardbit-sign-in.js', 'cardbit-sign-in.css', // Shopify customer_authentication window
  'cardbit-paid-packs.js', 'cardbit-member-account.js', 'cardbit-my-packs.js', 'cardbit-my-packs.css', // app-proxy pages
  'cardbit-pack-rehearsal.js', 'cardbit-app.js', 'cardbit-catalog.js',
  'cardbit-banner-giveaway.mp4', 'cardbit-banner-levels.mp4', 'cardbit-mystery-showcase.mp4', // replaced by canvas hero scenes
  'cardbit-latch-home-960.mp4',
]);

function patch(file, text, pairs) {
  for (const [from, to] of pairs) {
    if (!text.includes(from)) throw new Error(`${file}: patch anchor not found:\n${from.slice(0, 160)}`);
    text = text.split(from).join(to);
  }
  return text;
}

const here = dirname(fileURLToPath(import.meta.url));
const SHIP_TOGETHER = readFileSync(join(here, 'patches/ship-together.js'), 'utf8');
const LIVE_PULLS = readFileSync(join(here, 'patches/live-pulls.js'), 'utf8');
const SHIP_HOME = readFileSync(join(here, 'patches/ship-home.js'), 'utf8');
// The theme's Ship Home step, replaced whole by patches/ship-home.js.
const SHIP_HOME_FROM = readFileSync(join(here, 'patches/ship-home.from.txt'), 'utf8');

const PATCHES = {
  'cardbit-collector-tools.js': [
    // Ship Together: real address form and Cardbits fee on the site (scripts/site/patches/ship-together.js).
    ["    let review=null;\n", SHIP_TOGETHER + "    let review=null;\n"],
    ["Browse Packs','packs')+parcelList()+'</div>';\n", "Browse Packs','packs')+parcelList()+'</div>';\n      /* SITE */ if(siteShip())return siteShipPage(opening,held);\n"],
    ["    function summary(){return ", "    function summary(){/* SITE */ if(siteShip())return siteSummary();return "],
    ["    function reviewParcel(){\n", "    function reviewParcel(){\n      /* SITE */ if(siteShip())return siteReview();\n"],
    ["    async function commitParcel(){\n", "    async function commitParcel(){\n      /* SITE */ if(siteShip())return siteCommit();\n"],
    ["      if(el.hasAttribute('data-parcel-copy')){", "      /* SITE */ if(el.hasAttribute('data-parcel-field')){address[el.dataset.parcelField]=el.value;saveAddress();if(ctx.root().querySelector('[data-parcel-summary] [role=alert]'))updateSummary();return true;}\n      if(el.hasAttribute('data-parcel-copy')){"],
  ],
  'cardbit-collector-pages.js': [
    // Shipment detail: show the site's destination text, Cardbits fee and carrier.
    ["['Destination',dest?.label],\n            ['Postage','Calculated at Shipping Checkout']",
     "['Destination',dest?.label || (typeof p.destination==='string' ? p.destination : null)],\n            /* SITE */ ['Shipping',root.CardbitStore?.site ? (p.feeBits ? Number(p.feeBits).toLocaleString('en-US')+' Cardbits' : 'Free') : 'Calculated at Shipping Checkout']"],
    ["esc([p.tracking.company,'Tracking Number '+p.tracking.number]", "esc([p.tracking.company || p.tracking.carrier,'Tracking Number '+p.tracking.number]"],
  ],
  'cardbit-storefront.js': [
    // The site store reports mode 'shopper-test' (server-held account with per-card retailBits),
    // so the existing server-account code paths apply. These patches cover what differs on the site.
    ["const isDemoShopper = () => window.CardbitStore?.mode === 'shopper-test';",
     "const isDemoShopper = () => window.CardbitStore?.mode === 'shopper-test';\n  /* SITE */ const site = () => window.CardbitStore?.site === true;"],
    // Sign in goes to the site's own sign-in page.
    ["  function loginForm(context='Your Collector Account', localProfiles=false){\n",
     "  function loginForm(context='Your Collector Account', localProfiles=false){\n    /* SITE */ if (site()) return '<div class=\"cb-login\"><p class=\"cb-kicker\">Collector Account</p><h2>'+esc(context)+'</h2><p>Sign In With Google or an Email Code to Open Packs, Hold Cards in Your Vault and Buy Cardbits.</p><a class=\"cb-primary\" href=\"'+esc(window.CardbitSite.signInURL())+'\">Sign In'+icon('arrow')+'</a></div>';\n"],
    // Top-ups go to the site's checkout page; no simulated payment picker.
    ["    const item=action==='topup'?null:itemFor(action,id);\n",
     "    /* SITE */ if (site() && action==='topup') { location.assign(window.CardbitSite.topupURL(amount)); return; }\n    const item=action==='topup'?null:itemFor(action,id);\n"],
    // Pool reads use the site API.
    ["fetch('/apps/packs/api/pool?product='+enc(product)", "fetch(window.CardbitSite.api('pool?product='+enc(product))"],
    ["fetch('/apps/packs/api/pool?product=' + enc(product)", "fetch(window.CardbitSite.api('pool?product=' + enc(product))"],
    ['<a href="/pages/official-rules">Official Rules</a>', '<a href="/official-rules">Official Rules</a>'],
    // A single-card ship request goes to Ship Together, which collects the delivery address.
    ["    /* SITE */ if (site() && action==='topup')", "    /* SITE */ if (site() && action==='ship') { navigate('ship-together/select/'+enc(id)); return; }\n    /* SITE */ if (site() && action==='topup')"],
    // Footer Policies is a plain link like the others (policyLink adds the blue cb-textlink style).
    ["+welcomeLink+policyLink('Policies')+", "+welcomeLink+/* SITE */(site() ? '<a href=\"'+esc(root.dataset.policyView || '/policies')+'\">Policies</a>' : policyLink('Policies'))+"],
    // Live Pulls card feed on the home page, without the text ticker (Trevor, Nov 24).
    ["    return heroCarousel()+'<div class=\"cb-wrap cb-stack cb-home-stack\">'+\n", "    return heroCarousel()+'<div class=\"cb-wrap cb-stack cb-home-stack\">'+/* SITE */(site() ? pullFeed() : '')+\n"],
    ["    if (root.dataset.mode !== 'demo' || !(inBrowser() || isDemoShopper())) return '';\n", "    if (!site() && (root.dataset.mode !== 'demo' || !(inBrowser() || isDemoShopper()))) return '';\n"],
    ["      '<div class=\"cbf-ticker\" data-pull-ticker hidden>", "      /* SITE */(site() ? '' : '<div class=\"cbf-ticker\" data-pull-ticker hidden>"],
    ["<div class=\"cbf-ticker-track\" data-ticker-track aria-live=\"polite\"></div></div>'+\n", "<div class=\"cbf-ticker-track\" data-ticker-track aria-live=\"polite\"></div></div>')+\n"],
    ["    let paused = motion.matches, hover = false, available = true;\n", "    let paused = motion.matches, hover = false, available = true;\n    /* SITE */ let live = null;\n"],
    ["    function draw() {\n      const markup = visible.map(", "    function draw() {\n      /* SITE */ if (live) return drawLive();\n      const markup = visible.map("],
    ["        toggle.hidden = printings.size <= 5;", "        toggle.hidden = live ? true : printings.size <= 5;"],
    ["    toggle.addEventListener('click',()=>{paused=!paused;syncControl();},{signal});\n", LIVE_PULLS + "    toggle.addEventListener('click',()=>{paused=!paused;syncControl();},{signal});\n"],
  ],
  'cardbit-hero-scenes.js': [
    // Conveyor: whole number of evenly spaced packs, so the wrap never stacks two packs (Trevor, Nov 24).
    ["const ph = H * (mobile ? .34 : .42), gap = ph * .82, speed = W * .06;\n      const span = W + gap * 2, count = Math.ceil(span / gap) + 1;",
     "const ph = H * (mobile ? .34 : .42), speed = W * .06;\n      /* SITE */ const count = Math.max(2, Math.floor((W + ph * 1.64) / (ph * .82))), gap = (W + ph * 1.64) / count, span = gap * count;"],
    // Desktop: banners 2 and 3 keep Latch inside the page's content column (mobile unchanged, Trevor).
    ["try { scene(g, W, H, T, { first, resized, pointer, rect }); }",
     "/* SITE */ const inner = slide.querySelector('.cbh-inner')?.getBoundingClientRect(); const colL = inner?.width ? inner.left - rect.left : 0, colR = inner?.width ? inner.right - rect.left : W;\n      try { scene(g, W, H, T, { first, resized, pointer, rect, colL, colR }); }"],
    ["      const minX = W * (mobile ? .66 : .56), maxX = W * .92;\n      if (lx == null || ctx.resized) lx = W * .78;",
     "      /* SITE */ const cL = mobile ? 0 : ctx.colL ?? 0, cW = mobile ? W : (ctx.colR ?? W) - cL;\n      const minX = cL + cW * (mobile ? .66 : .56), maxX = mobile ? W * .92 : Math.min(cL + cW * .92, cL + cW - lh * .3);\n      if (lx == null || ctx.resized) lx = cL + cW * .78;"],
    ["const goalX = target ? target.x : W * .78 + Math.sin(T * .6) * W * .06;", "const goalX = target ? target.x : cL + cW * .78 + Math.sin(T * .6) * cW * .06;"],
    ["      const x0 = W * (mobile ? .1 : .5), x1 = W * (mobile ? .9 : .94);",
     "      /* SITE */ const cL = mobile ? 0 : ctx.colL ?? 0, cW = mobile ? W : (ctx.colR ?? W) - cL;\n      const x0 = cL + cW * (mobile ? .1 : .5), x1 = cL + cW * (mobile ? .9 : .94);"],
    // Ship Home: the card no longer shows through the box (Trevor, Nov 24).
    [SHIP_HOME_FROM, SHIP_HOME],
  ],
  'cardbit-flair.js': [
    // Holo shine sits on the pack image's own box and rotation, not the whole stage (pack page).
    ["    img.after(holo);\n  }\n", "    img.after(holo);\n    /* SITE */ fitHolo(img, holo);\n  }\n  /* SITE */ function fitHolo(img, holo) {\n    const sync = () => {\n      const host = img.parentElement;\n      if (!host || !holo.isConnected || !img.offsetWidth) return;\n      const t = getComputedStyle(img).transform;\n      const turned = t && t !== 'none';\n      if (!turned && img.offsetWidth >= host.clientWidth - 2 && img.offsetHeight >= host.clientHeight - 2) return;\n      Object.assign(holo.style, {inset:'auto', left:img.offsetLeft+'px', top:img.offsetTop+'px', width:img.offsetWidth+'px', height:img.offsetHeight+'px', transform:turned ? t : ''});\n    };\n    sync();\n    if (!img.complete) img.addEventListener('load', sync, {once:true});\n    if (window.ResizeObserver) new ResizeObserver(sync).observe(img);\n  }\n"],
  ],
};

const PAGE_LINKS = [
  // Theme links use query routing (/?cb=packs); the site uses paths (/packs).
  [/href="\/\?cb=([a-z0-9/-]+)"/g, 'href="/$1"'],
  [/href="\/pages\/official-rules"/g, 'href="/official-rules"'],
  [/href="\/\?view=policies"/g, 'href="/policies"'],
  [/href="\/\?view=how-it-works"/g, 'href="/help"'],
  // Shopify's built-in policy URLs -> the matching section of the site's Policies page.
  [/href="\/policies\/terms-of-service"/g, 'href="/policies#terms"'],
  [/href="\/policies\/refund-policy"/g, 'href="/policies#refund-policy"'],
  [/href="\/policies\/shipping-policy"/g, 'href="/policies#shipping-policy"'],
  [/href="\/policies\/privacy-policy"/g, 'href="/policies#privacy-policy"'],
  [/href="\/policies\/contact-information"/g, 'href="/policies#contact"'],
];

// 1. Assets
rmSync(outAssets, { recursive: true, force: true });
mkdirSync(outAssets, { recursive: true });
let copied = 0;
for (const name of readdirSync(join(theme, 'assets'))) {
  if (!name.startsWith('cardbit-') || SKIP.has(name)) continue;
  const src = join(theme, 'assets', name), dest = join(outAssets, name);
  if (PATCHES[name]) writeFileSync(dest, patch(name, readFileSync(src, 'utf8'), PATCHES[name]));
  else copyFileSync(src, dest);
  copied++;
}
for (const name of Object.keys(PATCHES)) if (!existsSync(join(outAssets, name))) throw new Error(`missing ${name}`);
// Site-only replacements for theme files (for example a cleaned image); each must replace a theme file.
for (const name of readdirSync(join(here, 'overrides'))) {
  if (!existsSync(join(outAssets, name))) throw new Error(`override ${name} has no theme file to replace`);
  copyFileSync(join(here, 'overrides', name), join(outAssets, name));
}
// Manifest: file -> short content hash, used for cache-busting URLs and window.cardbitAssets.
const manifest = {};
for (const name of readdirSync(outAssets).sort()) {
  manifest[name] = createHash('sha256').update(readFileSync(join(outAssets, name))).digest('hex').slice(0, 10);
}
mkdirSync(join(repo, 'app/site'), { recursive: true });
writeFileSync(join(repo, 'app/site/assets-manifest.json'), JSON.stringify(manifest, null, 1) + '\n');

// 2. Partials rendered from the theme's Liquid sections
const { Liquid } = await import('liquidjs').catch(() => {
  console.error('liquidjs is needed: npm i --no-save liquidjs@10'); process.exit(1);
});
const engine = new Liquid({ root: [join(theme, 'snippets')], extname: '.liquid', strictFilters: false, strictVariables: false });
engine.registerFilter('asset_url', name => `/site/assets/${name}`);
engine.registerFilter('stylesheet_tag', () => ''); // the shell links stylesheets itself
engine.registerFilter('image_url', v => v);
engine.registerTag('schema', { parse(_t, rem) { this.tpls = []; const s = this.liquid.parser.parseStream(rem).on('tag:endschema', function () { s.stop(); }).on('template', () => {}).on('end', () => { throw new Error('schema not closed'); }); s.start(); }, render() { return ''; } });
engine.registerTag('doc', { parse(_t, rem) { const s = this.liquid.parser.parseStream(rem).on('tag:enddoc', function () { s.stop(); }).on('template', () => {}); s.start(); }, render() { return ''; } });
const ctx = { routes: { root_url: '/' }, section: { settings: {} }, pages: {}, theme: { role: 'main' }, shop: {} };

async function section(file, settings = {}) {
  let html = await engine.parseAndRender(readFileSync(join(theme, 'sections', file), 'utf8'), { ...ctx, section: { settings } });
  html = html.replace(/<script src="\/site\/assets\/[^"]+"[^>]*><\/script>/g, ''); // the shell loads scripts
  for (const [re, to] of PAGE_LINKS) html = html.replace(re, to);
  return html.trim() + '\n';
}

mkdirSync(outPartials, { recursive: true });
const how = await section('cardbit-how-it-works.liquid');
if (!how.includes('<template id="cb-portable-how">')) throw new Error('How It Works template id changed');
writeFileSync(join(outPartials, 'how-it-works.html'), how);

const policySettings = JSON.parse(readFileSync(join(theme, 'templates/index.policies.json'), 'utf8')).sections.policies.settings;
writeFileSync(join(outPartials, 'policies.html'), await section('cardbit-policies.liquid', policySettings));

console.log(`Copied ${copied} assets to public/site/assets; wrote ${readdirSync(outPartials).length} partials.`);
