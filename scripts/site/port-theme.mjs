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
const AGE_CONFIRM = readFileSync(join(here, 'patches/age-confirm.js'), 'utf8');
// The theme's Ship Home step, replaced whole by patches/ship-home.js.
const SHIP_HOME_FROM = readFileSync(join(here, 'patches/ship-home.from.txt'), 'utf8');

const PATCHES = {
  'cardbit-leaderboard.js': [
    // Pack Pass: frame around members' icons (public/site/js/cardbit-site-pass.js).
    ["  function face(node, r) {\n", "  function face(node, r) { /* SITE */ siteFace(node, r); window.CardbitPass?.frame(node, r && r.tier, { small: !node.classList.contains('cbr-pod-avatar') }); }\n  function siteFace(node, r) {\n"],
  ],
  'cardbit-collector-tools.js': [
    // Chase: the first rows load right away (lazy loading left desktop tiles blank in some browsers).
    ["    function chaseTile({row,variants}){\n", "    function chaseTile({row,variants},index){\n"],
    ["      return link('chase/'+enc(row.key),art(c)+'<div><strong>'", "      return link('chase/'+enc(row.key),art(c,/* SITE */ index<15)+'<div><strong>'"],
    // Ship Together: real address form and Cardbits fee on the site (scripts/site/patches/ship-together.js).
    ["    let review=null;\n", SHIP_TOGETHER + "    let review=null;\n"],
    ["Browse Packs','packs')+parcelList()+'</div>';\n", "Browse Packs','packs')+parcelList()+'</div>';\n      /* SITE */ if(siteShip())return siteShipPage(opening,held);\n"],
    ["    function summary(){return ", "    function summary(){/* SITE */ if(siteShip())return siteSummary();return "],
    ["    function reviewParcel(){\n", "    function reviewParcel(){\n      /* SITE */ if(siteShip())return siteReview();\n"],
    ["    async function commitParcel(){\n", "    async function commitParcel(){\n      /* SITE */ if(siteShip())return siteCommit();\n"],
    ["      if(el.hasAttribute('data-parcel-copy')){", "      /* SITE */ if(el.hasAttribute('data-parcel-field')){address[el.dataset.parcelField]=el.value;saveAddress();if(ctx.root().querySelector('[data-parcel-summary] [role=alert]'))updateSummary();return true;}\n      if(el.hasAttribute('data-parcel-copy')){"],
  ],
  'cardbit-collector-pages.js': [
    // Vault market data on the site: per-card labels and the Vault Portfolio panel read /api/portfolio.
    ["const quote = get().mode==='shopper-test' && root.CardbitVaultMarket?.label(c);", "const quote = get().mode==='shopper-test' && (root.CardbitStore?.site ? root.CardbitSite?.marketLabel?.(c) : root.CardbitVaultMarket?.label(c));"],
    ['<cardbit-vault-portfolio data-source="shopper"></cardbit-vault-portfolio>', '<cardbit-vault-portfolio data-source="\'+(root.CardbitStore?.site ? \'wallet\' : \'shopper\')+\'"></cardbit-vault-portfolio>'],
    ["    function updateVault() {\n", "    /* SITE */ root.CardbitSiteRefreshVault = () => updateVault();\n    function updateVault() {\n"],
    // Shipment detail: show the site's destination text, Cardbits fee and carrier.
    ["['Destination',dest?.label],\n            ['Postage','Calculated at Shipping Checkout']",
     "['Destination',dest?.label || (typeof p.destination==='string' ? p.destination : null)],\n            /* SITE */ ['Shipping',root.CardbitStore?.site ? (p.feeBits ? Number(p.feeBits).toLocaleString('en-US')+' Cardbits' : 'Free') : 'Calculated at Shipping Checkout']"],
    ["esc([p.tracking.company,'Tracking Number '+p.tracking.number]", "esc([p.tracking.company || p.tracking.carrier,'Tracking Number '+p.tracking.number]"],
  ],
  'cardbit-storefront.js': [
    // Pack Pass links in the header and footer (site only, Trevor Nov 25).
    ["nav('help','How It Works')+'</nav><nav aria", "nav('help','How It Works')+/* SITE */(site() ? '<a class=\"cb-navlink cb-nav-passlink\" href=\"/pass\"><span class=\"cb-nav-icon cb-nav-pass\" aria-hidden=\"true\"></span><span>Pack Pass</span></a>' : '')+'</nav><nav aria"],
    ["link('help','How It Works')+welcomeLink+", "link('help','How It Works')+/* SITE */(site() ? '<a href=\"/pass\">Pack Pass</a>' : '')+welcomeLink+"],
    // Site: the home feed is called Live Pulls.
    ["'<h2 id=\"cb-feed-title\">Just Pulled</h2>'+", "'<h2 id=\"cb-feed-title\">'+(/* SITE */ site() ? 'Live Pulls' : 'Just Pulled')+'</h2>'+"],
    ["toggle.setAttribute('aria-label',(paused?'Play':'Pause')+' Just Pulled');", "toggle.setAttribute('aria-label',(paused?'Play':'Pause')+(/* SITE */ site() ? ' Live Pulls' : ' Just Pulled'));"],
    // Site: player card (level, XP, Cardbits, Sparks) on pack pages.
    ["'<p class=\"cb-micro\">Demo openings use no Cardbits and add no cards to your vault.</p></div></div>' + seriesGallery()", "'<p class=\"cb-micro\">Demo openings use no Cardbits and add no cards to your vault.</p>' + (/* SITE */ site() && window.CardbitPlayerPanel ? window.CardbitPlayerPanel.html(pack) : '') + '</div></div>' + seriesGallery()"],
    ["link(path+'/pool','View Card Pool','cb-secondary') + '</div></div>';", "link(path+'/pool','View Card Pool','cb-secondary') + '</div>' + (/* SITE */ site() && window.CardbitPlayerPanel ? window.CardbitPlayerPanel.html(pack) : '') + '</div>';"],
    // Site: XP and Sparks on the pack reveal.
    ["onFinish:()=>navigate(sample?'packs/'+enc(p.id):'vault/opening/'+enc(o.id)),", "onFinish:()=>navigate(sample?'packs/'+enc(p.id):'vault/opening/'+enc(o.id)),/* SITE */ onSpread:sample||!site()?null:()=>window.CardbitRevealRewards?.node(o),"],
    // Site: community Discord in the footer.
    ["<div class=\"cb-foot-end\"><span>Cardbit, LLC · Madison, Alabama</span></div>", "<div class=\"cb-foot-end\"><span>Cardbit, LLC · Madison, Alabama</span>'+/* SITE */(site() ? '<div class=\"cb-foot-socials\"><a class=\"cb-foot-social\" href=\"https://discord.gg/F9Z6jbgj4Y\" target=\"_blank\" rel=\"noopener\" aria-label=\"Join Our Discord (opens in a new tab)\"><svg aria-hidden=\"true\" focusable=\"false\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18.2 18.2 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.7 19.7 0 0 0 6 3l1.3-2.1a12.8 12.8 0 0 1-2-1l.5-.4a14 14 0 0 0 12.2 0l.5.4a12.8 12.8 0 0 1-2 1l1.3 2.1a19.6 19.6 0 0 0 6-3c.5-5.2-.9-9.7-3.6-13.7ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z\"/></svg><span>Join Our Discord</span></a><a class=\"cb-foot-social cb-foot-facebook\" href=\"https://www.facebook.com/cardbitshop\" target=\"_blank\" rel=\"noopener\" aria-label=\"Follow Cardbit on Facebook (opens in a new tab)\"><svg aria-hidden=\"true\" focusable=\"false\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12Z\"/></svg><span>Facebook</span></a><a class=\"cb-foot-social cb-foot-instagram\" href=\"https://www.instagram.com/cardbitshop\" target=\"_blank\" rel=\"noopener\" aria-label=\"Follow Cardbit on Instagram (opens in a new tab)\"><svg aria-hidden=\"true\" focusable=\"false\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"5\"/><circle cx=\"12\" cy=\"12\" r=\"4\"/><circle cx=\"17.5\" cy=\"6.5\" r=\".6\" fill=\"currentColor\"/></svg><span>Instagram</span></a><a class=\"cb-foot-social cb-foot-whatnot\" href=\"https://whatnot.com/invite/pokecollectcards\" target=\"_blank\" rel=\"noopener\" aria-label=\"Join Whatnot and Get a $25 Credit (opens in a new tab)\"><img class=\"cb-foot-logo\" alt=\"\" width=\"18\" height=\"18\" src=\"'+esc(asset('giveaway-whatnot.png'))+'\"><span>Whatnot</span><b class=\"cb-foot-badge\">Get $25 Credit</b></a></div>' : '')+'</div>"],
    // Site: Sparks balance next to the Cardbits wallet.
    ["'</nav><nav aria-label=\"Account\" class=\"cb-account\">'+wallet+accountLink()", "'</nav><nav aria-label=\"Account\" class=\"cb-account\">'+wallet+/* SITE */ sparksPill()+accountLink()"],
    ["  function header(route){\n", "  /* SITE */ function sparksPill(){const raw=site()?account()?.sparks:null;if(raw==null)return '';const n=window.CardbitRevealRewards?.shownSparks?.(raw)??raw;const v=number(n);return '<a class=\"cb-sparks-link\" href=\"/rewards\" aria-label=\"Sparks, Balance '+v+'\"><img alt=\"\" width=\"20\" height=\"20\" src=\"'+esc(asset('sparks.svg'))+'\"><span data-sparks-balance>'+v+'</span></a>';}\n  function header(route){\n"],
    // Site Welcome Rewards render in the app at /welcome (no on-device sample wallet).
    ["    if (route === 'welcome' && window.CardbitWelcome) return window.CardbitWelcome.entry;", "    if (route === 'welcome' && window.CardbitWelcome && !site()) return window.CardbitWelcome.entry;"],
    ["    if (base === 'welcome' && window.CardbitWelcome && !window.CardbitWelcome.isSample) {", "    if (base === 'welcome' && window.CardbitWelcome && !window.CardbitWelcome.isSample && !site()) {"],
    ["else if(base==='welcome' && window.CardbitWelcome?.isSample){body=window.CardbitWelcome.page(state);", "else if(base==='welcome' && (window.CardbitWelcome?.isSample || (site() && window.CardbitWelcome))){body=window.CardbitWelcome.page(state);"],
    ["    if (window.CardbitWelcome && ((route === 'welcome' && !window.CardbitWelcome.isSample) || (!route && window.CardbitWelcome.isSample))) {", "    if (window.CardbitWelcome && !site() && ((route === 'welcome' && !window.CardbitWelcome.isSample) || (!route && window.CardbitWelcome.isSample))) {"],
    // Shop Singles: same eager first rows as Chase.
    ["  function shopTile(card, meta) {\n", "  function shopTile(card, meta, eager=false) {\n"],
    ["    return link('shop/'+enc(card.id),frontScan(card,false)+", "    return link('shop/'+enc(card.id),frontScan(card,eager)+"],
    ["})),({variants})=>shopTile(variants[0].card,pages.metadata(variants[0].card)));", "})),({variants},index)=>shopTile(variants[0].card,pages.metadata(variants[0].card),/* SITE */ site() && index<15));"],
    // No "Back Unverified" / "Scan Pending" wording on singles without a back photo.
    ["'<div class=\"cb-scan-actions\"><small>'+ (design?.file==='card-back-ja-old.webp'?'Vintage Japanese Back · Scan Pending':'Back Unverified')+'</small>'+tools", "'<div class=\"cb-scan-actions\">'+/* SITE */(site() ? '' : '<small>'+ (design?.file==='card-back-ja-old.webp'?'Vintage Japanese Back · Scan Pending':'Back Unverified')+'</small>')+tools"],
    // Signed out on the site: the wallet reads 0 (like Shopify), not a dash.
    ["const walletBalance=account()?.bits ?? walletBalanceLive ?? (root.hasAttribute('data-member-signed-in') || isDemoShopper() ? null : 0);", "const walletBalance=account()?.bits ?? walletBalanceLive ?? (/* SITE */ site() && state && !account() ? 0 : root.hasAttribute('data-member-signed-in') || isDemoShopper() ? null : 0);"],
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
    // No category tags (Pokemon, Modern, Vintage...) under the pack tiles (Trevor, Nov 24).
    ["'cb-edition-name')+categoryTags(pack.id,true)+list;", "'cb-edition-name')+/* SITE */(site() ? '' : categoryTags(pack.id,true))+list;"],
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
  'cardbit-opening.js': [
    // Site: XP and Sparks earned by this pack, above the pulls (public/site/js/cardbit-site-store.js renders them).
    ["      player.append(list);\n", "      /* SITE */ if(typeof options.onSpread==='function'){const extra=options.onSpread();if(extra)player.append(extra);}\n      player.append(list);\n"],
  ],
  'cardbit-card-media.js': [
    // Site: Japanese copies carry no release date, so a Japanese card the set lists don't place gets the modern back.
    ["    if (set.some(key => newSets.has(key))) return backs['ja-modern'];\n    return null;\n", "    if (set.some(key => newSets.has(key))) return backs['ja-modern'];\n    /* SITE */ if (root.CardbitStore?.site) return backs['ja-modern'];\n    return null;\n"],
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
  'cardbit-rewards.js': [
    // Site: streak copy says what the boost is (card prizes N% more likely, relative), not "Card Odds".
    ["    $('[data-rw-bonus]').textContent = '+' + Math.round(days * sb.perDay * 100) + '% Card Odds';", "    $('[data-rw-bonus]').textContent = /* SITE */ days ? 'Card Prizes ' + Math.round(days * sb.perDay * 100) + '% More Likely' : 'No Streak Boost Yet';"],
    ["      : 'Check In Every Day. Each Day in a Row Boosts Your Card Odds, Up to ' + sb.maxDays + ' Days.';", "      : /* SITE */ 'Check In Every Day. Each Day in a Row Makes Card Prizes on Your Daily Spins ' + Math.round(sb.perDay * 100) + '% More Likely, Up to ' + sb.maxDays + ' Days.';"],
    // Site: a clear saved highlight on the chosen icon, and the header badge follows the new icon/level.
    ["    try { render(await call({ action: 'avatar', ...body })); note.textContent = 'Saved.'; }", "    try { const saved = await call({ action: 'avatar', ...body }); render(saved); note.textContent = 'Icon Saved'; /* SITE */ savedFlash(note); window.CardbitRewardsNav?.update({ level: saved.level, avatar: saved.avatar }); }"],
    ["  async function save(body) {\n", "  /* SITE */ function savedFlash(note) {\n    const picked = root.querySelector('[data-rw-icons] [aria-pressed=\"true\"], [data-rw-colors] [aria-pressed=\"true\"]');\n    for (const n of [picked, note, root.querySelector('.cbr-hero-avatar, [data-rw-avatar]')]) { if (!n) continue; n.classList.remove('cbr-saved'); void n.offsetWidth; n.classList.add('cbr-saved'); }\n  }\n  async function save(body) {\n"],
    // Cardbit Club icons: locked label says Club, not a level.
    ["b.append(img(iconUrls[i.id], 64, 64), el('span', null, i.name), el('small', null, i.unlocked ? '' : 'Level ' + i.minLevel));\n      b.setAttribute('aria-label', i.unlocked ? i.name : i.name + ', Unlocks at Level ' + i.minLevel);",
     "b.append(img(iconUrls[i.id], 64, 64), el('span', null, i.name), el('small', null, i.unlocked ? '' : /* SITE */ i.club ? ((window.cardbitPlan || {}).short || 'Pass') : 'Level ' + i.minLevel));\n      b.setAttribute('aria-label', i.unlocked ? i.name : i.name + (/* SITE */ i.club ? ', For ' + ((window.cardbitPlan || {}).name || 'Pack Pass') + ' Members' : ', Unlocks at Level ' + i.minLevel));"],
    // 18+ confirmation when the server asks for it (site only; Shopify uses its own age gate).
    ["  async function call(body) {\n", AGE_CONFIRM + "  async function call(body) {\n"],
    ["    if (!res.ok) throw Object.assign(new Error(data.error || 'Something Went Wrong.'), { status: res.status });",
     "    /* SITE */ if (!res.ok && data.code === 'AGE_REQUIRED' && body && body.action !== 'confirm-age' && await siteConfirmAge()) return call(body);\n    if (!res.ok) throw Object.assign(new Error(data.error || 'Something Went Wrong.'), { status: res.status });"],
    // Pack Pass: frame around the member's icon and the emote picker (public/site/js/cardbit-site-pass.js).
    ["    avatar($('[data-rw-avatar]'), data);\n", "    avatar($('[data-rw-avatar]'), data);\n    /* SITE */ window.CardbitPass?.frame($('[data-rw-avatar]'), data.pass && data.pass.tier, { small: false });\n"],
    ["    const r = data.rules;\n", "    /* SITE */ window.CardbitPass?.picker(root, data, (iconId) => save({ iconId }));\n    const r = data.rules;\n"],
    ["avatar: saved.avatar });", "avatar: saved.avatar, pass: saved.pass });"],
  ],
  'cardbit-rewards-nav.js': [
    // Site: the badge follows level-ups and icon changes without a reload.
    ["  fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' })\n", "  /* SITE */ window.CardbitRewardsNav = { update(next) {\n    if (!data || !next) return;\n    const up = Number.isFinite(next.level) && next.level > data.level;\n    data = { ...data, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v != null)) };\n    for (const a of document.querySelectorAll('#cardbit-store .cbr-nav')) {\n      a.innerHTML = badge() + '<span>Lv ' + data.level + '</span>'; a.setAttribute('aria-label', 'Rewards, Level ' + data.level);\n      if (up) { a.classList.remove('cbr-nav-up'); void a.offsetWidth; a.classList.add('cbr-nav-up'); }\n    }\n  } };\n  fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' })\n"],
    // Site: site API and /rewards path; only for signed-in customers.
    ["const endpoint = new URL(root + 'apps/packs/api/rewards', location.origin).pathname;", "const endpoint = store.dataset.mode === 'site' ? '/api/rewards' : new URL(root + 'apps/packs/api/rewards', location.origin).pathname;"],
    ["  function href() {\n", "  function href() {\n    /* SITE */ if (store.dataset.mode === 'site') return '/rewards';\n"],
    ["      data = d && d.enabled && d.signedIn ? d : START;", "      /* SITE */ if (store.dataset.mode === 'site' && !(d && d.enabled && d.signedIn)) return;\n      data = d && d.enabled && d.signedIn ? d : START;"],
    // Pack Pass: frame around the header badge (public/site/js/cardbit-site-pass.js).
    ["  function badge() {\n", "  function badge() { /* SITE */ const t = data.pass && data.pass.tier, f = t && window.CardbitPass ? window.CardbitPass.html(t, true) : ''; return f ? '<span class=\"cbp-mini\">' + siteBadge() + f + '</span>' : siteBadge(); }\n  function siteBadge() {\n"],
  ],
  'cardbit-how-it-works.js': [
    // Never leave a tile invisible: anything at or above the viewport bottom shows (fast jumps, anchors, find-in-page, print).
    ["    items.forEach(el => { el.setAttribute('data-hiw-in', ''); io.observe(el); });\n",
     "    items.forEach(el => { el.setAttribute('data-hiw-in', ''); io.observe(el); });\n    /* SITE */ const sweep = () => items.forEach(el => { if (!el.classList.contains('is-in') && el.getBoundingClientRect().top < innerHeight) { el.classList.add('is-in'); io.unobserve(el); } });\n    /* SITE */ requestAnimationFrame(sweep); addEventListener('scroll', sweep, {passive:true}); addEventListener('resize', sweep); addEventListener('load', sweep);\n    /* SITE */ const tick = setInterval(() => { if (!root.isConnected || [...items].every(el => el.classList.contains('is-in'))) clearInterval(tick); else sweep(); }, 700); // IntersectionObserver can stall (hidden or embedded views); timers still run.\n    /* SITE */ addEventListener('beforeprint', () => items.forEach(el => el.classList.add('is-in')));\n"],
  ],
  'cardbit-giveaway-entry.js': [
    // Site: path routing (home is "/"), sign-in return_to, email signup lives in Welcome Rewards.
    ["  function onHome() {\n", "  function onHome() {\n    /* SITE */ if (script.dataset.endpoint === '/api/giveaway') return location.pathname === '/' && !location.hash;\n"],
    ["      login.searchParams.set('return_url',back.pathname + back.search);", "      login.searchParams.set(/* SITE */ script.dataset.endpoint === '/api/giveaway' ? 'return_to' : 'return_url',back.pathname + back.search);"],
    ["      extraLink.href = root + '?cb=cardbits';", "      extraLink.href = /* SITE */ script.dataset.endpoint === '/api/giveaway' ? '/cardbits' : root + '?cb=cardbits';"],
    ["    if (key === 'email') preferences.href = root + '?cb=welcome';", "    if (key === 'email') preferences.href = /* SITE */ script.dataset.endpoint === '/api/giveaway' ? '/welcome' : root + '?cb=welcome';"],
  ],
  'cardbit-flair.js': [
    // Holo shine sits on the pack image's own box and rotation, not the whole stage (pack page).
    ["    img.after(holo);\n  }\n", "    img.after(holo);\n    /* SITE */ fitHolo(img, holo);\n  }\n  /* SITE */ function fitHolo(img, holo) {\n    const sync = () => {\n      const host = img.parentElement;\n      if (!host || !holo.isConnected || !img.offsetWidth) return;\n      const t = getComputedStyle(img).transform;\n      const turned = t && t !== 'none';\n      if (!turned && img.offsetWidth >= host.clientWidth - 2 && img.offsetHeight >= host.clientHeight - 2) return;\n      Object.assign(holo.style, {inset:'auto', left:img.offsetLeft+'px', top:img.offsetTop+'px', width:img.offsetWidth+'px', height:img.offsetHeight+'px', transform:turned ? t : ''});\n    };\n    sync();\n    if (!img.complete) img.addEventListener('load', sync, {once:true});\n    if (window.ResizeObserver) new ResizeObserver(sync).observe(img);\n  }\n"],
  ],
};

const PAGE_LINKS = [
  // Rewards and Leaderboard pages (Shopify ?view= routes) -> site paths and site API.
  [/(href|data-vault|data-board)="\/\?view=account#vault"/g, '$1="/vault"'],
  [/(href|data-vault|data-board)="\/\?view=account"/g, '$1="/account"'],
  [/(href|data-vault|data-board)="\/\?view=rewards"/g, '$1="/rewards"'],
  [/(href|data-vault|data-board)="\/\?view=leaderboard"/g, '$1="/leaderboard"'],
  [/data-endpoint="\/apps\/packs\/api\/rewards"/g, 'data-endpoint="/api/rewards"'],
  [/href="\/customer_authentication\/login\?return_to=\/\?view=([a-z]+)"/g, 'href="/sign-in?return_to=%2F$1"'],
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
// Theme files are replaced; site-only subfolders (email/) are kept.
mkdirSync(outAssets, { recursive: true });
for (const name of readdirSync(outAssets, { withFileTypes: true })) if (name.isFile()) rmSync(join(outAssets, name.name));
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
for (const name of readdirSync(outAssets, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name).sort()) {
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
// Theme translations (en.default.json allows comments).
const LOCALE = JSON.parse(readFileSync(join(theme, 'locales/en.default.json'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''));
engine.registerFilter('t', key => String(key).split('.').reduce((o, k) => o?.[k], LOCALE) ?? key);
engine.registerFilter('sha256', v => createHash('sha256').update(String(v)).digest('hex'));
engine.registerTag('schema', { parse(_t, rem) { this.tpls = []; const s = this.liquid.parser.parseStream(rem).on('tag:endschema', function () { s.stop(); }).on('template', () => {}).on('end', () => { throw new Error('schema not closed'); }); s.start(); }, render() { return ''; } });
engine.registerTag('doc', { parse(_t, rem) { const s = this.liquid.parser.parseStream(rem).on('tag:enddoc', function () { s.stop(); }).on('template', () => {}); s.start(); }, render() { return ''; } });
const ctx = { routes: { root_url: '/' }, section: { settings: {} }, pages: {}, theme: { role: 'main' }, shop: {} };

async function section(file, settings = {}) {
  let html = await engine.parseAndRender(readFileSync(join(theme, 'sections', file), 'utf8'), { ...ctx, section: { settings } });
  html = html.replace(/<script src="\/site\/assets\/[^"]+"[^>]*><\/script>/g, ''); // the shell loads scripts
  for (const [re, to] of PAGE_LINKS) html = html.replace(re, to);
  return html.trim() + '\n';
}

// Site-only page wording. Rule (Trevor, Nov 24): any site change that affects How It Works or Policies
// updates them in the same change. Each anchor must exist, so a theme rewrite fails loudly here.
const PAGE_COPY = {
  'how-it-works.html': [
    // Verified Shuffle (site only).
    ["still waiting to be pulled.</p>", "still waiting to be pulled.</p>\n      <h3>Verified Shuffle</h3>\n      <p>Every paid opening is drawn with a locked secret seed whose fingerprint you can see before you open, plus a client seed you can set yourself. Reveal the seed any time on the <a href=\"/verified-shuffle\">Verified Shuffle</a> page and check that it picked exactly your cards.</p>"],
    ['<b>Free Shipping</b> on Vault shipments of more than 30 cards.', '<b>Free Shipping</b> on Vault shipments of 30 or more cards, or 10,000 Cardbits or more in card value.'],
    ['Vault shipments of more than 30 cards ship free.', 'Vault shipments of 30 or more cards, or 10,000 Cardbits or more in card value, ship free.'],
    // Welcome Rewards on the site: text-alert Cardbits are credited after the number confirms (Trevor, Nov 25).
    ['then add text alerts for <strong>300 more</strong>.</p>', 'then add text alerts for <strong>300 more</strong> once you confirm your number by text.</p>'],
    // Founding Collector bonus (waitlist, Trevor Nov 25).
    ["once you confirm your number by text.</p>", "once you confirm your number by text.</p>\n          <p>On the waitlist? <strong>Founding Collectors</strong> get <strong>1,000 Cardbits</strong> instead (400 for email, 600 for a confirmed phone number), added with your first top-up on an account using the same email.</p>"],
    // Daily Giveaway on the site: email news + one Whatnot follow unlock entry; referrals aren't offered on the site yet.
    ['Join once a day for your free entry, then earn bonus entries:', 'Join once a day for your free entry (Cardbit email news must be on, and you follow us on Whatnot once), then earn bonus entries:'],
    ['          <li>Refer a friend</li>\n', ''],
    // Lost packages (Trevor, Nov 25): refunded in Cardbits only when the carrier (USPS) confirms the loss; never replaced.
    ["If a package is lost in transit, we replace it.", "If USPS (or the carrier used) confirms a package is lost, we refund the full value of the cards and products in it in Cardbits, since each card is one of a kind and can’t be replaced."],
    ["<summary>What If My Package Is Lost?</summary><p>If your package is lost in transit, we'll replace it.", "<summary>What If My Package Is Lost?</summary><p>Once USPS (or the carrier used) confirms your package is lost, we refund the total value of the cards and products in it as Cardbits, valued at each item's Cardbit price (or its buyback offer) on the day you requested the shipment. Every card is one of a kind, so we can't send a replacement. Report it within 30 days of the expected delivery date."],
    // Pack Pass monthly plans (shown only while plans are open).
    ["<p class=\"hiw-small\">XP has no cash value.", "<!--plan:start--><h3>{{PLAN_NAME}}</h3>\n      <p>Want Cardbits every month? <a href=\"{{PLAN_PATH}}\">{{PLAN_NAME}}</a> adds a set amount of Cardbits plus bonus Cardbits each month, with extra XP and Sparks on paid packs, a portrait frame around your icon, animated emotes on Pro and Ultimate, free Ship Together shipping on Pro and Ultimate, a better buyback offer on Ultimate, a Discord role and a members' chat room. Plans are Plus ($24.99), Pro ($49.99) and Ultimate ($199.99), renew monthly until you cancel, and you can cancel any time on the {{PLAN_NAME}} page. A plan never adds Daily Spins or giveaway entries; those stay free for everyone.</p><!--plan:end-->\n      <p class=\"hiw-small\">XP has no cash value."],
    ["<details><summary>How Is a Buyback Offer Decided?</summary>", "<!--plan:start--><details><summary>How Do I Cancel {{PLAN_NAME}}?</summary><p>Go to the <a href=\"{{PLAN_PATH}}\">{{PLAN_NAME}}</a> page and choose Cancel Renewal, or email Support@cardbit.com. Cancel at least a day before your renewal date to avoid the next charge. You won't be charged again, Cardbits already added stay in your balance, and your perks last until the end of the month you paid for.</p></details><!--plan:end-->\n      <details><summary>How Is a Buyback Offer Decided?</summary>"],
  ],
  'policies.html': [
    // Verified Shuffle (site only).
    ["<li class=\"is-yes\">Odds update live from the packs still unclaimed</li>", "<li class=\"is-yes\">Odds update live from the packs still unclaimed</li>\n          <li class=\"is-yes\">Every draw can be checked on the <a href=\"/verified-shuffle\">Verified Shuffle</a> page</li>"],
    ["Odds change as packs are opened. <strong>Packs have no minimum card value.</strong>", "Odds change as packs are opened. Each paid opening is drawn with a committed server seed, your client seed and an opening number, and you can verify the draw after revealing the seed on the Verified Shuffle page. <strong>Packs have no minimum card value.</strong>"],
    ['$6 or 600 Cardbits, free over 30 cards.', '$6 or 600 Cardbits, free at 30+ cards or 10,000 Cardbits of card value.'],
    ['<div class="is-free"><b>Free</b><span>Over 30 cards</span></div>', '<div class="is-free"><b>Free</b><span>30+ cards or 10,000 Cardbits value</span></div>'],
    ['shipments of more than 30 cards ship free.', 'shipments of 30 or more cards, or of cards worth 10,000 Cardbits or more in total, ship free.'],
    ['Signup rewards are one per person, email and phone number.', 'Signup rewards are one per person, email and phone number. Text-alert Cardbits are added after you confirm your number by replying YES to our text.'],
    // Limits & Breaks (site only, Trevor Nov 24): account rule + Terms paragraph.
    ["<li class=\"cbp-reveal\"><b>Fraud Screening</b><span>We screen for fraud and sanctions and may hold or reverse suspicious activity.</span></li>\n", "<li class=\"cbp-reveal\"><b>Fraud Screening</b><span>We screen for fraud and sanctions and may hold or reverse suspicious activity.</span></li>\n        <li class=\"cbp-reveal\"><b>Limits &amp; Breaks</b><span>Set top-up and spend limits, take a cool-off or self-exclude any time in My Account. Raising a limit takes 24 hours.</span></li>\n"],
    ["<h3>4. Cardbits</h3>", "<p><strong>Limits and breaks.</strong> In My Account \u203a Limits &amp; Breaks you can set daily, weekly and monthly limits on Cardbits purchases (in dollars) and on Cardbits spent on packs and singles. Lowering or adding a limit applies at once; raising or removing one takes effect 24 hours later. You can also start a cool-off (24 hours to 30 days) or a self-exclusion (6 months to 5 years). While either is active you can't buy Cardbits, packs or singles, use Daily Spins or renew a subscription, but you can still view your Vault, ship cards and sell cards back. A cool-off or self-exclusion can't be shortened or canceled once it starts.</p>\n\n<h3>4. Cardbits</h3>"],
    // Live chat rules (site only, Trevor Nov 24).
    ["<h3>4. Cardbits</h3>", "<p><strong>Chat.</strong> Where chat is offered, it is for signed-in account holders 18 and older, and the {{PLAN_SHORT}} room is for {{PLAN_NAME}} members. Be respectful. Don't post links, email addresses, phone numbers or other contact details, arrange trades or sales off Cardbit, spam, harass anyone or share anything illegal or sexual. Staff may remove messages and mute or close accounts that break these rules. Chat is paused during a cool-off or self-exclusion. Messages are visible to other members and are not private.</p>\n\n<h3>4. Cardbits</h3>"],
    // Founding Collector bonus for waitlist signups (Trevor, Nov 25): 1,000 Cardbits unlocked by the first top-up.
    ["Text-alert Cardbits are added after you confirm your number by replying YES to our text.", "Text-alert Cardbits are added after you confirm your number by replying YES to our text. Joined the waitlist before launch? Founding Collectors get 1,000 Cardbits instead (400 for email, 600 for a confirmed phone number), added with your first top-up on an account using the same email."],
    ["Cardbit may cancel bonus Cardbits obtained by misusing a code, including through multiple accounts.", "Cardbit may cancel bonus Cardbits obtained by misusing a code, including through multiple accounts. <strong>Founding Collector bonus.</strong> People who joined the Cardbit waitlist before launch receive a Founding Collector badge and up to 1,000 promotional Cardbits: 400 for the waitlist email and 600 for a mobile number confirmed for Cardbit text alerts. The bonus is added after the first top-up of any amount, confirmed by our payment processor, on a Cardbit account that uses the same email address (ignoring dots and +tags in Gmail addresses), and the text-alert part once that number is confirmed. It replaces the regular signup rewards for that account, so any signup rewards already received count toward the 1,000. One bonus per person, email address and phone number; disposable email addresses are not eligible. If the unlocking top-up is refunded or charged back, the bonus is removed. Cardbit may withhold or remove the bonus where it suspects multiple accounts or other misuse."],
    ['<strong>Free shipping</strong> for any single shipment of more than 30 cards.', '<strong>Free shipping</strong> for any single shipment of 30 or more cards, or of cards worth 10,000 Cardbits or more in total.'],
    // Lost packages (Trevor, Nov 25): refunded in Cardbits only when the carrier (USPS) confirms the loss; never replaced.
    ["<p><strong>Last Updated: November 24, 2026</strong></p>\n<p>This Refund Policy is part of", "<p><strong>Last Updated: November 25, 2026</strong></p>\n<p>This Refund Policy is part of"],
    ["<figcaption class=\"cbp-panel-title\">Lost Before Delivery</figcaption><p>Carrier confirms it is lost, or it never got a delivery scan: <strong>we replace your cards.</strong> Claim within 30 days of the expected delivery date.</p>", "<figcaption class=\"cbp-panel-title\">Lost Before Delivery</figcaption><p>Only once USPS (or the carrier used) confirms it is lost: <strong>we refund the full value in Cardbits.</strong> Every card is one of a kind, so we can’t send a replacement. Claim within 30 days of the expected delivery date.</p>"],
    ["<tr><th>Lost in transit</th><td>Cards replaced</td></tr>", "<tr><th>Lost in transit (carrier confirmed)</th><td>Full value refunded in Cardbits</td></tr>"],
    ["<li><strong>Lost in transit:</strong> if the carrier shows a package as lost, or it has no delivery scan and the carrier confirms it cannot be found, Cardbit will <strong>replace</strong> the cards with the same cards in the same or better condition. If an identical card is not available, Cardbit will credit Cardbits equal to its buyback offer at the time, increased by 25%. Lost packages are replaced, not refunded in cash.</li>", "<li><strong>Lost in transit:</strong> only when USPS (or the carrier that handled the package) confirms that the package is lost, Cardbit will <strong>refund the total value of the cards and products in that package in Cardbits</strong>, valued at each item’s Cardbit price (or its buyback offer, if it has no price) on the day the shipment was requested. Each card is a one-of-a-kind physical copy, so lost packages are not replaced, and they are not refunded in cash. A package that is only late, or whose tracking has stopped updating, is not treated as lost until the carrier confirms it.</li>"],
    ["Every shipment is insured while in transit. If the carrier shows your package as lost, or the package has no delivery scan and the carrier confirms it cannot be found, Cardbit will <strong>replace</strong> the cards with the same cards in the same or better condition. If an identical card is not available, Cardbit will credit Cardbits equal to its buyback offer at the time, increased by 25%. Please contact us if tracking has not updated for 10 days. Lost-package claims must be made within 30 days of the expected delivery date. Lost packages are replaced, not refunded in cash.", "Every shipment is insured while in transit. Please contact us if tracking has not updated for 10 days, and we will open a search with the carrier. A package counts as lost only when USPS (or the carrier that handled it) confirms that it is lost. Cardbit will then <strong>refund the total value of the cards and products in that package in Cardbits</strong>, valued at each item’s Cardbit price (or its buyback offer, if it has no price) on the day the shipment was requested. The Cardbits are added to your balance and appear in your Cardbits history. Because every card is a one-of-a-kind physical copy, lost packages are not replaced, and they are not refunded in cash. Lost-package claims must be made within 30 days of the expected delivery date."],
    // Pack Pass monthly plans (Trevor, Nov 25): Terms. Shown only while plans are open (plan-brand.ts withPlanCopy).
    ["<h3>12. Rewards Program</h3>", "<!--plan:start--><p><strong>{{PLAN_NAME}} (monthly plans).</strong> {{PLAN_NAME}} is an optional monthly plan (Plus $24.99, Pro $49.99 or Ultimate $199.99 per month). Each paid month adds that plan's Cardbits to your balance: the Cardbits equal to the price you paid, plus promotional bonus Cardbits shown on the <a href=\"{{PLAN_PATH}}\">{{PLAN_NAME}} page</a>. Members also get the perks listed there (extra XP and Sparks on paid pack openings, a portrait frame around their icon, animated emotes on Pro and Ultimate, Legendary emotes on Ultimate, free Ship Together shipping (one shipment a month on Pro, every shipment on Ultimate), an 85% buyback offer instead of 80% on Ultimate, a {{PLAN_NAME}} Discord role and a members' chat room) while their plan is paid up. A plan never adds Daily Spins, giveaway entries or leaderboard points.</p>\n<p><strong>Automatic renewal.</strong> When you join, you agree that your plan renews automatically every month, on the same day of the month you joined, at the plan's price then in effect, charged to the card you used, until you cancel. We email you a receipt with your renewal date and how to cancel after every charge. If a renewal fails, the processor may retry it for a few days; your perks continue during that time, and the plan ends if the charge still fails. We will email you at least 30 days before any price change, and you can cancel before it applies.</p>\n<p><strong>Cancelling.</strong> You can cancel any time on the {{PLAN_NAME}} page or by emailing <a href=\"mailto:Support@cardbit.com\">Support@cardbit.com</a>. Cancel at least one day before your renewal date to avoid the next charge. After you cancel you won't be charged again, and your perks last until the end of the month you paid for. Starting a cool-off or self-exclusion cancels renewal automatically. Cardbit may cancel a plan for a chargeback, fraud or a breach of these Terms. You can have one plan at a time; to change plans, cancel and join the new plan after your current month ends.</p>\n<p><strong>Plan charges and limits.</strong> Plan charges count toward your Top-Up Limits. A plan's Cardbits follow the rules for Cardbits in Section 4: purchased Cardbits never expire, bonus Cardbits are promotional, and none can be cashed out. Monthly plans are available only where Cardbits can be bought.</p><!--plan:end-->\n<h3>12. Rewards Program</h3>"],
    // Pack Pass monthly plans: Refund Policy.
    ["\n<h3>9. Time Limits</h3>", "\n<!--plan:start--><h3>8a. {{PLAN_NAME}} Monthly Plans</h3>\n<p>Each monthly charge is final once that month's Cardbits are added to your balance, like a top-up. If you were charged after you canceled, or charged twice for the same month, contact us within 60 days and we will refund that charge and remove its Cardbits. If a plan charge is refunded or charged back, the Cardbits from that month, including bonus Cardbits, are deducted as described in Section 8. Cancelling stops future charges; it does not refund the current month, and your perks last until it ends.</p><!--plan:end-->\n\n<h3>9. Time Limits</h3>"],
    // Ask Latch AI help assistant (site only, Trevor Nov 25 2026): Terms paragraph + Privacy Policy disclosures.
    ["<h3>4. Cardbits</h3>", "<p><strong>Ask Latch (AI help).</strong> Ask Latch is an automated assistant powered by artificial intelligence, not a person. It answers general questions using the information published on cardbit.com. Its answers may be incomplete or wrong, and they are not promises: these Terms, our policies and the Official Rules always control. Ask Latch cannot see or change your account, balance, orders, vault, shipments or payments, and it cannot approve refunds, credits or exceptions; for help with your account or an order, email <a href=\"mailto:Support@cardbit.com\">Support@cardbit.com</a>. Don't share passwords, payment card numbers or other sensitive information in a chat. Ask Latch is for adults 18 and older, is paused during a cool-off or self-exclusion, and is limited to a number of questions per hour and day.</p>\n\n<h3>4. Cardbits</h3>"],
    ["<details id=\"terms\" open><summary><b>Terms of Service</b><span>Includes Arbitration and Class Action Waiver</span></summary><div class=\"cbp-legal-body\"><p><strong>Last Updated: November 25, 2026</strong></p>", "<details id=\"terms\" open><summary><b>Terms of Service</b><span>Includes Arbitration and Class Action Waiver</span></summary><div class=\"cbp-legal-body\"><p><strong>Last Updated: November 26, 2026</strong></p>"],
    ["<details id=\"privacy-policy\"><summary><b>Privacy Policy</b><span>Includes Text Message Terms</span></summary><div class=\"cbp-legal-body\"><p><strong>Last Updated: November 25, 2026</strong></p>", "<details id=\"privacy-policy\"><summary><b>Privacy Policy</b><span>Includes Text Message Terms</span></summary><div class=\"cbp-legal-body\"><p><strong>Last Updated: November 26, 2026</strong></p>"],
    ["<li><strong>Communications:</strong> emails and messages you send to support, survey answers, and mail-in sweepstakes entries.</li>", "<li><strong>Communications:</strong> emails and messages you send to support, survey answers, and mail-in sweepstakes entries.</li>\n<li><strong>Ask Latch chats:</strong> the questions you type into Ask Latch, our AI help assistant, and its answers, linked to your account if you are signed in, plus a one-way hashed form of your IP address and a random cookie used to limit how many questions can be asked.</li>"],
    ["<li>To provide customer support and send service messages, such as receipts, shipping updates, security codes and policy notices.</li>", "<li>To provide customer support and send service messages, such as receipts, shipping updates, security codes and policy notices.</li>\n<li>To answer questions in Ask Latch. Your questions and the published pages of cardbit.com are sent to our AI provider, Anthropic, to write each answer. Cardbit staff review chats to check answers and improve support. Ask Latch is not used to make decisions about your account.</li>"],
    ["bot protection, IP-based location lookup, identity or age verification, shipping carriers and label providers, and customer support tools.</li>", "bot protection, IP-based location lookup, identity or age verification, shipping carriers and label providers, and customer support tools, including our AI help assistant provider (Anthropic), which processes Ask Latch chats to answer them.</li>"],
    ["and then delete or de-identify it.</p>", "and then delete or de-identify it. Ask Latch chats are deleted 90 days after the last message.</p>"],
    ["<p class=\"cbp-meta\">Last Updated November 25, 2026 · ", "<p class=\"cbp-meta\">Last Updated November 26, 2026 · "],
  ],
};

mkdirSync(outPartials, { recursive: true });
const how = patch('how-it-works.html', await section('cardbit-how-it-works.liquid'), PAGE_COPY['how-it-works.html']);
if (!how.includes('<template id="cb-portable-how">')) throw new Error('How It Works template id changed');
writeFileSync(join(outPartials, 'how-it-works.html'), how);

const policySettings = JSON.parse(readFileSync(join(theme, 'templates/index.policies.json'), 'utf8')).sections.policies.settings;
writeFileSync(join(outPartials, 'policies.html'), patch('policies.html', await section('cardbit-policies.liquid', policySettings), PAGE_COPY['policies.html']));

// Daily Giveaway window and home pill (the site's own drawing, /api/giveaway). Referral entries are not
// wired on the site yet, so that bonus method is left out rather than promised. Paid-Cardbit entries are live.
{
  const prev = { shop: ctx.shop, theme: ctx.theme, request: ctx.request };
  Object.assign(ctx, { shop: { permanent_domain: 'hhuuev-81.myshopify.com' }, theme: { id: 168753070242, role: 'main' }, request: { page_type: 'index' } });
  let html = await engine.parseAndRender(readFileSync(join(theme, 'sections', 'cardbit-giveaway-placement.liquid'), 'utf8'), { ...ctx, section: { settings: {} } });
  Object.assign(ctx, prev);
  html = html.replace(/<script src="\/site\/assets\/cardbit-giveaway-entry\.js"[\s\S]*?><\/script>/, '<script src="/site/assets/cardbit-giveaway-entry.js" data-cardbit-entry data-account="site" data-endpoint="/api/giveaway" data-root="/" data-login="/sign-in" defer></script>');
  for (const method of ['referral']) {
    const re = new RegExp('<button type="button" class="cbg-method cbg-' + method + '"[\\s\\S]*?</button>');
    if (!re.test(html)) throw new Error('giveaway method ' + method + ' markup changed');
    html = html.replace(re, '');
  }
  html = html.replace('Email Marketing Must Be Enabled.', 'Cardbit Email News Must Be On (Welcome Rewards).');
  html = html.replace('Enable Email Marketing in Your Cardbit Account to Unlock Entry.', 'Join Cardbit Email News in Welcome Rewards to Unlock Entry.').replace('>Email Preferences<', '>Join Email News<');
  if (!html.includes('data-cbg-dialog') || /apps\/packs|account_login|customer_authentication/.test(html)) throw new Error('giveaway: unported markup');
  writeFileSync(join(outPartials, 'giveaway.html'), html.trim() + '\n');
}

// Rewards and Leaderboard: signed-in and signed-out variants. %%FIRST%%/%%LAST%% are filled per request.
const member = { first_name: '%%FIRST%%', last_name: '%%LAST%%' };
for (const [file, out] of [['cardbit-rewards.liquid', 'rewards'], ['cardbit-leaderboard.liquid', 'leaderboard']]) {
  for (const [variant, customer] of [['in', member], ['out', null]]) {
    const prev = ctx.customer; ctx.customer = customer;
    const html = await section(file);
    ctx.customer = prev;
    if (/apps\/packs|view=|customer_authentication/.test(html)) throw new Error(`${out}-${variant}: unported Shopify link`);
    writeFileSync(join(outPartials, `${out}-${variant}.html`), html);
  }
}

console.log(`Copied ${copied} assets to public/site/assets; wrote ${readdirSync(outPartials).length} partials.`);
