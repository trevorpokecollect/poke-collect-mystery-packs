/**
 * Cardbit standalone site: HTML shell for the storefront pages.
 *
 * The approved Cardbit Dark design is one client app (public/site/assets/cardbit-storefront.js)
 * with path routing. The server sends this shell; the client renders the page for the URL and
 * reads data from /api/store/* (see public/site/js/cardbit-site-store.js).
 *
 * Mirrors the theme's layout/cardbit-dark.liquid. Regenerate assets and partials with
 * scripts/site/port-theme.mjs; do not hand-edit public/site/assets.
 */
import { protectionScript } from "./payments/coinflow.server";
import manifest from "./assets-manifest.json";
import howItWorks from "./partials/how-it-works.html?raw";
import siteStoreSource from "../../public/site/js/cardbit-site-store.js?raw";
import siteCssSource from "../../public/site/css/cardbit-site.css?raw";
import siteAuthSource from "../../public/site/js/cardbit-site-auth.js?raw";
import siteAuthCssSource from "../../public/site/css/cardbit-site-auth.css?raw";
import { createHash } from "node:crypto";

const files = manifest as Record<string, string>;
// Cache-busting versions for the site's own files (not part of the theme port).
const version = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 10);
const SITE_STORE_V = version(siteStoreSource);
const SITE_CSS_V = version(siteCssSource);
const SITE_AUTH_V = version(siteAuthSource);
const SITE_AUTH_CSS_V = version(siteAuthCssSource);

export const SITE_ENABLED = () => process.env.CARDBIT_SITE === "on";

export function assetUrl(name: string): string {
  const hash = files[name];
  if (!hash) throw new Error(`Cardbit site asset missing from manifest: ${name}`);
  return `/site/assets/${name}?v=${hash}`;
}

const escapeAttr = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// Script order matches layout/cardbit-dark.liquid; every script is deferred, so they run in order.
const STYLES = [
  "cardbit-storefront.css",
  "cardbit-collector-tools.css",
  "cardbit-collector-pages.css",
  "cardbit-latch-player.css",
  "cardbit-opening.css",
  "cardbit-brand-motion.css",
  "cardbit-values.css",
  "cardbit-how-it-works.css",
  "cardbit-topups.css",
  "cardbit-polish.css",
  "cardbit-flair.css",
];
const SCRIPTS = [
  "cardbit-collector-rules.js",
  "cardbit-value-view.js",
  "SITE_STORE",
  "cardbit-card-media.js",
  "cardbit-latch-opening.js",
  "cardbit-opening.js",
  "cardbit-share-pull.js",
  "cardbit-collector-tools.js",
  "cardbit-brand-motion.js",
  "cardbit-hero-scenes.js",
  "cardbit-collector-pages.js",
  "cardbit-flair.js",
  "cardbit-how-it-works.js",
  "cardbit-storefront.js",
];

function assetMap(): string {
  // window.cardbitAssets: theme files keyed without the "cardbit-" prefix, as the storefront expects.
  const map: Record<string, string> = {};
  for (const name of Object.keys(files)) {
    if (/\.(?:webp|png|jpe?g|svg|mp4|wav)$/i.test(name)) map[name.replace(/^cardbit-/, "")] = assetUrl(name);
  }
  return JSON.stringify(map).replace(/</g, "\\u003c");
}

export interface ShellOptions {
  title?: string;
  /** Extra data-* attributes on #cardbit-store. */
  data?: Record<string, string>;
}

export function storefrontShell({ title = "cardbit · Packs and Singles", data = {} }: ShellOptions = {}): string {
  const attrs: Record<string, string> = {
    id: "cardbit-store",
    "data-routing": "path",
    "data-mode": "site",
    "data-api-base": "/api",
    "data-sign-in": "/sign-in",
    "data-topup-checkout": "/checkout/cardbits",
    "data-policy-view": "/policies",
    "data-rewards-view": "/rewards",
    "data-shelf-title": "Shop Packs",
    "data-order": "mystery,booster,gold,japanese,wildcard",
    "data-animate-header": "true",
    "data-autoplay-hero": "true",
    ...data,
  };
  const rootAttrs = Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeAttr(value)}"`)
    .join(" ");
  const styles = [
    ...STYLES.map((name) => `<link rel="stylesheet" href="${assetUrl(name)}">`),
    `<link rel="stylesheet" href="/site/css/cardbit-site.css?v=${SITE_CSS_V}">`,
    `<link rel="stylesheet" href="/site/css/cardbit-site-auth.css?v=${SITE_AUTH_CSS_V}">`,
  ].join("\n    ");
  const scripts = SCRIPTS.map((name) =>
    name === "SITE_STORE"
      ? `<script src="/site/js/cardbit-site-store.js?v=${SITE_STORE_V}" defer></script>`
      : `<script src="${assetUrl(name)}" defer></script>`,
  ).join("\n    ") + `\n    <script src="/site/js/cardbit-site-auth.js?v=${SITE_AUTH_V}" defer></script>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#101619">
    <meta name="robots" content="noindex, nofollow">
    <meta name="referrer" content="same-origin">
    <title>${escapeAttr(title)}</title>
    <link rel="icon" type="image/png" href="${assetUrl("cardbit-brand-emblem.png")}">
    ${styles}
    <style>
      body { margin: 0; background: #101619; color: #f6faf9; }
      .cb-loading { margin: 0 auto; max-width: 80rem; min-height: 50vh; padding: 2rem; font: 1rem system-ui, sans-serif; }
      .cb-loading img { object-fit: contain; }
    </style>
    <script>
      window.cardbitAssets = ${assetMap()};
      window.cardbitValueIcon = window.cardbitAssets["bits-card-emblem.png"];
    </script>
    ${protectionScript()}
    ${scripts}
  </head>
  <body>
    <div ${rootAttrs}>
      <div class="cb-loading" role="status" aria-live="polite">
        <img src="${assetUrl("cardbit-brand-lockup.webp")}" width="158" height="32" alt="cardbit">
        <p>Loading the Card Shop…</p>
      </div>
    </div>
    <noscript><p>Enable JavaScript to Browse the Cards or Open a Pack.</p><a href="mailto:Support@cardbit.com">Support@cardbit.com</a></noscript>
    ${howItWorks}
  </body>
</html>`;
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
    },
  });
}

export const notFound = () => new Response("Not Found", { status: 404 });
