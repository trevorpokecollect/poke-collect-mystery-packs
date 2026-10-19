import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { proxyContext } from "../lib/proxy.server";
import { boardCards, hasMarketAccess, marketSettings } from "../lib/market.server";
import { validDemoToken } from "../lib/demo.server";

// The Vault Marketplace at /apps/packs/market. Unlike My Packs it is its own full page (not wrapped
// in the store theme), so it can look and feel like a separate site. The app proxy passes a plain
// text/html response through untouched.
const VERSION = (process.env.RAILWAY_DEPLOYMENT_ID || process.env.RAILWAY_GIT_COMMIT_SHA || String(Date.now())).slice(0, 12);

const FONTS =
  "https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700;800&family=Figtree:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap";

// The store's own favicon (the Poke-Collect logo), so the tab matches poke-collect.com.
const FAVICON = "https://poke-collect.com/cdn/shop/files/Logo_Inverted_f6f1059b-c34e-41fe-a1fb-019ee80646f3.png?v=1722967747&crop=center";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(assets: string, body: string, title = "Vault Market · Poke-Collect") {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${title}</title>
<link rel="icon" type="image/png" href="${FAVICON}&width=96&height=96">
<link rel="apple-touch-icon" href="${FAVICON}&width=180&height=180">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${assets}/packs/market.css?v=${VERSION}">
</head>
<body class="vm">
${body}
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

function landing(assets: string, heading: string, text: string, button?: { href: string; label: string }) {
  return page(
    assets,
    `<header class="vm-top"><a class="vm-logo" href="/apps/packs/market"><span class="vm-logo-mark">Vault Market</span><span class="vm-logo-by">By Poke-Collect</span></a><a class="vm-top-link" href="/">Back To The Store</a></header>
<main class="vm-landing">
  <p class="vm-eyebrow">Player To Player</p>
  <h1 class="vm-landing-title">${heading}</h1>
  <p class="vm-landing-text">${text}</p>
  ${button ? `<a class="vm-btn vm-btn-signal" href="${button.href}">${button.label}</a>` : ""}
</main>`,
  );
}

// The store's own login (the one poke-collect.com/pages/account uses), returning to the market.
// Never /account/login, which sends customers to Shopify's hosted account pages.
const LOGIN_URL = "/customer_authentication/login?return_to=" + encodeURIComponent("/apps/packs/market");

const money = (n: number) => `$${n.toFixed(2)}`;

type BoardCard = Awaited<ReturnType<typeof boardCards>>[number];

// Logged-out visitors: what's up right now (listed cards with their sellers' prices first), and Log In.
function publicPage(assets: string, board: BoardCard[]) {
  const forSale = board.filter((c) => c.listing).sort((a, b) => b.listing!.price - a.listing!.price);
  const forTrade = board.filter((c) => !c.listing);
  const shown = [...forSale, ...forTrade].slice(0, 24);
  const collectors = new Set(board.map((c) => c.trader)).size;
  const tile = (c: BoardCard) => `<a class="vm-pub-card" href="${LOGIN_URL}" aria-label="${escape(c.title)}: log in to ${c.listing ? "buy" : "trade"}">
      <span class="vm-pub-art">${c.imageUrl ? `<img src="${escape(c.imageUrl)}" alt="" loading="lazy">` : ""}</span>
      <span class="vm-pub-tag ${c.listing ? "vm-pub-sale" : "vm-pub-trade"}">${c.listing ? money(c.listing.price) : "For Trade"}</span>
      <span class="vm-pub-title">${escape(c.title)}</span>
      <span class="vm-pub-who">@${escape(c.trader)}</span>
    </a>`;
  return page(
    assets,
    `<div class="vm-store-bar"><a class="vm-store-back" href="/"><span aria-hidden="true">←</span> Back To Poke-Collect</a><div class="vm-store-links"><a href="/apps/packs">My Packs</a><a href="/">Shop</a><a href="${LOGIN_URL}">Log In</a></div></div>
<header class="vm-top"><a class="vm-logo" href="/apps/packs/market"><span class="vm-logo-mark">Vault Market</span><span class="vm-logo-by">By Poke-Collect</span></a></header>
<main class="vm-pub">
  <section class="vm-pub-hero">
    <p class="vm-eyebrow">Player To Player</p>
    <h1 class="vm-landing-title">Trade &amp; Sell Vault Cards</h1>
    <p class="vm-landing-text">Buy Cards Straight From Other Collectors' Vaults, Trade Card For Card, Or Sell Your Own Pulls. Every Card Stays Safe In The Poke-Collect Vault Until You Ship It.</p>
    <div class="vm-pub-cta"><a class="vm-btn vm-btn-signal" href="${LOGIN_URL}">Log In To Shop The Market</a></div>
    <div class="vm-pub-stats">
      <span><b>${forSale.length}</b> For Sale</span>
      <span><b>${forTrade.length}</b> Open To Trade</span>
      <span><b>${collectors}</b> Collectors</span>
    </div>
  </section>
  ${shown.length ? `<section class="vm-pub-section">
    <div class="vm-pub-head"><h2>${forSale.length ? "Up For Sale Now" : "Up For Trade Now"}</h2><a class="vm-link" href="${LOGIN_URL}">See Everything</a></div>
    <div class="vm-pub-grid">${shown.map(tile).join("")}</div>
  </section>` : ""}
  <section class="vm-pub-section vm-pub-how">
    <h2>How It Works</h2>
    <ol>
      <li><b>Open Packs</b><span>Every card you pull lands in your Poke-Collect vault.</span></li>
      <li><b>List Or Trade</b><span>Set your own price, or mark cards open to trade and swap with other collectors.</span></li>
      <li><b>Ship When Ready</b><span>Cards you buy or trade for join your vault. Ship them all together whenever you like.</span></li>
    </ol>
    <a class="vm-btn vm-btn-signal" href="${LOGIN_URL}">Log In</a>
    <p class="vm-fine">Sellers Set Their Own Prices. Poke-Collect Doesn't Buy Cards Back. <a class="vm-link" href="/pages/vault-market-terms">Vault Market Terms</a></p>
  </section>
</main>`,
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { viewer, shop, admin } = await proxyContext(request);
  const assets = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const app = (demo: string | null) =>
    page(
      assets,
      `<div id="vault-market" data-api="/apps/packs/api/market"${demo ? ` data-demo="${escape(demo)}"` : ""}></div>
<script src="${assets}/packs/market.js?v=${VERSION}" defer></script>`,
    );

  // Staff preview (?demo=<signed token> from the admin): sample cards, nothing saved, works while the marketplace is off.
  const demo = new URL(request.url).searchParams.get("demo");
  if (validDemoToken(shop, demo)) return app(demo);

  const settings = await marketSettings(db, shop);
  // Off, or a soft launch the visitor can't be checked against yet: nothing to see.
  if (!settings.enabled || (settings.accessTag && !viewer?.customerId)) {
    return landing(assets, "Coming Soon", "Trade And Sell The Cards In Your Vault With Other Collectors.");
  }
  if (!viewer?.customerId) {
    const board = await boardCards(db, shop, "").catch(() => [] as BoardCard[]);
    return publicPage(assets, board);
  }
  if (!(await hasMarketAccess(db, admin, shop, viewer.customerId))) {
    return landing(assets, "Coming Soon", "Trade And Sell The Cards In Your Vault With Other Collectors.");
  }
  return app(null);
};
