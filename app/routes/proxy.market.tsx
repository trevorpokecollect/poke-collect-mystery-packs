import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { proxyContext } from "../lib/proxy.server";
import { marketSettings } from "../lib/market.server";
import { validDemoToken } from "../lib/demo.server";

// The Vault Marketplace at /apps/packs/market. Unlike My Packs it is its own full page (not wrapped
// in the store theme), so it can look and feel like a separate site. The app proxy passes a plain
// text/html response through untouched.
const VERSION = (process.env.RAILWAY_DEPLOYMENT_ID || process.env.RAILWAY_GIT_COMMIT_SHA || String(Date.now())).slice(0, 12);

const FONTS =
  "https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700;800&family=Figtree:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap";

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { viewer, shop } = await proxyContext(request);
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

  if (!(await marketSettings(db, shop)).enabled) {
    return landing(assets, "Coming Soon", "Trade And Sell The Cards In Your Vault With Other Collectors.");
  }
  if (!viewer?.customerId) {
    return landing(assets, "Trade &amp; Sell Vault Cards", "Log In To Browse Every Card Up For Trade, See Other Collectors' Binders, And Make Offers.", {
      href: "/account/login?return_url=/apps/packs/market",
      label: "Log In",
    });
  }
  return app(null);
};
