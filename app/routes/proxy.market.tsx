import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { proxyContext } from "../lib/proxy.server";
import { marketSettings } from "../lib/market.server";

// The Vault Marketplace page at /apps/packs/market, inside the store theme like My Packs.
const VERSION = (process.env.RAILWAY_DEPLOYMENT_ID || process.env.RAILWAY_GIT_COMMIT_SHA || String(Date.now())).slice(0, 12);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { liquid, viewer, shop } = await proxyContext(request);
  const assets = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const styles = `<link rel="stylesheet" href="${assets}/packs/opener.css?v=${VERSION}"><link rel="stylesheet" href="${assets}/packs/market.css?v=${VERSION}">`;
  const shell = (body: string) =>
    liquid(`${styles}<div class="mp-page mk-page">${body}</div>`);

  if (!(await marketSettings(db, shop)).enabled) {
    return shell(`<section class="mp-hero"><div class="mp-hero-text"><span class="mp-hero-kicker">Digital Mystery Packs</span><h1>Vault Marketplace</h1><p class="mp-hero-sub">Coming Soon.</p></div></section>`);
  }
  if (!viewer?.customerId) {
    return shell(`<section class="mp-hero"><div class="mp-hero-text"><span class="mp-hero-kicker">Digital Mystery Packs · Vault Marketplace</span><h1>Trade &amp; Sell Vault Cards</h1><p class="mp-hero-sub">Log In To Trade Or Sell The Cards In Your Vault With Other Players.</p></div><div class="mp-hero-ship"><a class="mp-btn mp-vault-btn" href="{{ routes.account_login_url }}?return_url=/apps/packs/market">Log In</a></div></section>`);
  }
  return liquid(
    `${styles}<div class="mp-page mk-page" id="vault-market" data-api="/apps/packs/api/market"></div>
     <script src="${assets}/packs/market.js?v=${VERSION}" defer></script>`,
  );
};
