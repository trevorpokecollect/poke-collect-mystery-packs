import type { LoaderFunctionArgs } from "react-router";
import { proxyContext } from "../lib/proxy.server";
import { validDemoToken } from "../lib/demo.server";
import { FREE_SHIPPING_CARDS, SHIP_FEE } from "../lib/vault.server";

// Rendered inside the store theme at /apps/packs. The page shell is Liquid so it
// picks up the theme's header and footer; the opener script does the rest.
// Shown instantly when arriving from checkout (?open=1) and removed once the opening stage is up,
// so the packs list never flashes first. Inline so it applies before any stylesheet loads.
// Changes with every deploy so phones fetch the new opener files instead of a cached copy.
const VERSION = (process.env.RAILWAY_DEPLOYMENT_ID || process.env.RAILWAY_GIT_COMMIT_SHA || String(Date.now())).slice(0, 12);

// Same type as Vault Market, so My Packs reads as part of the same vault.
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700;800&family=Figtree:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap">`;

// Placeholder hero and card slots, shown until the packs arrive (the opener replaces it).
const SKELETON = `<div class="mp-skel" aria-busy="true" aria-label="Loading your packs"><div class="mp-skel-hero"></div><div class="mp-skel-title"></div><div class="mp-grid">${'<div class="mp-skel-card"></div>'.repeat(6)}</div></div>`;

const COVER = `<div id="mp-cover" style="position:fixed;inset:0;z-index:9998;display:grid;place-items:center;background:radial-gradient(circle at 50% 45%,#2b2140 0%,#0b0a12 70%);color:#c9c6d8;font:600 15px/1.4 system-ui,sans-serif;letter-spacing:.04em">Getting your pack ready…</div>`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { liquid, viewer, shop } = await proxyContext(request);
  const assets = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const url = new URL(request.url);
  const opening = url.searchParams.get("open") === "1";
  // Merchant preview with sample pulls (link from the app home); no login needed.
  const demo = validDemoToken(shop, url.searchParams.get("demo"));

  if (!viewer && !demo) {
    return liquid(
      `${FONTS}
      <link rel="stylesheet" href="${assets}/packs/opener.css?v=${VERSION}">
      <div class="mp-page mp-signin">
        <section class="mp-hero">
          <div class="mp-hero-text">
            <span class="mp-hero-kicker">Digital Mystery Packs · Your Vault</span>
            <h1>My Packs</h1>
            <p class="mp-hero-sub">Log In To Open Your Packs And See Every Card In Your Vault, Or Use The Link In Your Order Email.</p>
          </div>
          <div class="mp-hero-ship">
            <strong class="mp-hero-ship-title">Welcome Back</strong>
            <p>Your pulls wait in your vault until you ship them: $${SHIP_FEE} flat, free on ${FREE_SHIPPING_CARDS}+ cards (US only).</p>
            <a class="mp-btn mp-vault-btn" href="{{ routes.account_login_url }}?return_url=/apps/packs">Log In</a>
            <a class="mp-btn mp-btn-ghost" href="/products/poke-collect-mystery-pack">Shop Mystery Packs</a>
          </div>
        </section>
      </div>`,
    );
  }

  // Starts loading the packs while the opener script is still downloading (opener.js picks it up).
  // Same request the opener would make: ?open=1 is dropped, a guest's ?k= order token is kept.
  const first = `<script>(function(){var q=new URLSearchParams(location.search);q.delete("open");q=q.toString();
    window.__mpFirstPulls=fetch("/apps/packs/api/${demo ? "demo" : "pulls"}"+(q?"?"+q:""),{credentials:"same-origin"}).then(function(r){return r.json();});
    window.__mpFirstPulls.catch(function(){});})();</script>`;

  return liquid(
    `${opening ? COVER : ""}
     ${first}
     <link rel="preload" href="${assets}/packs/opener.js?v=${VERSION}" as="script">
     ${FONTS}
     <link rel="stylesheet" href="${assets}/packs/opener.css?v=${VERSION}">
     <div class="mp-page" id="mystery-packs" data-api="/apps/packs/api"${demo ? ' data-demo="1"' : ""}>${SKELETON}</div>
     <script src="${assets}/packs/opener.js?v=${VERSION}" defer></script>`,
  );
};
