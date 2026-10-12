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
      `<link rel="stylesheet" href="${assets}/packs/opener.css?v=${VERSION}">
      <div class="mp-page mp-signin">
        <section class="mp-hero">
          <div class="mp-hero-text">
            <span class="mp-hero-kicker">Digital Mystery Packs · Your Vault</span>
            <h1>My Packs</h1>
            <p class="mp-hero-sub">Log In To Open Your Packs And See Every Card In Your Vault, Or Use The Link In Your Order Email.</p>
          </div>
          <div class="mp-hero-ship">
            <strong class="mp-hero-ship-title">Welcome Back</strong>
            <p>Your pulls wait in your vault until you ship them: $${SHIP_FEE} flat, free on ${FREE_SHIPPING_CARDS}+ cards.</p>
            <a class="mp-btn mp-vault-btn" href="{{ routes.account_login_url }}?return_url=/apps/packs">Log In</a>
            <a class="mp-btn mp-btn-ghost" href="/products/poke-collect-mystery-pack">Shop Mystery Packs</a>
          </div>
        </section>
      </div>`,
    );
  }

  return liquid(
    `${opening ? COVER : ""}
     <link rel="preload" href="${assets}/packs/opener.js?v=${VERSION}" as="script">
     <link rel="stylesheet" href="${assets}/packs/opener.css?v=${VERSION}">
     <div class="mp-page" id="mystery-packs" data-api="/apps/packs/api"${demo ? ' data-demo="1"' : ""}></div>
     <script src="${assets}/packs/opener.js?v=${VERSION}" defer></script>`,
  );
};
