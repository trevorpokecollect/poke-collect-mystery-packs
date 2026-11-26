import { robotsTags } from "./seo.server";
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
import giveaway from "./partials/giveaway.html?raw";
import siteStoreSource from "../../public/site/js/cardbit-site-store.js?raw";
import siteCssSource from "../../public/site/css/cardbit-site.css?raw";
import siteAuthSource from "../../public/site/js/cardbit-site-auth.js?raw";
import siteAuthCssSource from "../../public/site/css/cardbit-site-auth.css?raw";
import sitePlaySource from "../../public/site/js/cardbit-site-play.js?raw";
import sitePlayCssSource from "../../public/site/css/cardbit-site-play.css?raw";
import siteChatSource from "../../public/site/js/cardbit-site-chat.js?raw";
import sitePassSource from "../../public/site/js/cardbit-site-pass.js?raw";
import siteLivePullsSource from "../../public/site/js/cardbit-site-live-pulls.js?raw";
import siteLivePullsCssSource from "../../public/site/css/cardbit-site-live-pulls.css?raw";
import siteDecodeSource from "../../public/site/js/cardbit-site-decode.js?raw";
import siteDecodeCssSource from "../../public/site/css/cardbit-site-decode.css?raw";
import siteUprightSource from "../../public/site/js/cardbit-site-upright.js?raw";
import siteChatCssSource from "../../public/site/css/cardbit-site-chat.css?raw";
import sitePulseSource from "../../public/site/js/cardbit-site-pulse.js?raw";
import siteAdsSource from "../../public/site/js/cardbit-site-ads.js?raw";
const chatOn = () => process.env.SITE_CHAT === "on"; // same flag as app/site/play/chat.server.ts
import { createHash } from "node:crypto";
import { signInProviders } from "./core/oauth.server";
import { PASS_ICON_URLS, passClientJson } from "./play/pass-icons";
import { planClientJson, withPlanCopy } from "./play/plan-brand";
import { subscriptionsReady } from "./payments/coinflow-subscriptions.server";
import { helpTags } from "./help/tag.server";

const files = manifest as Record<string, string>;
// Cache-busting versions for the site's own files (not part of the theme port).
const version = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 10);
const SITE_STORE_V = version(siteStoreSource);
export const SITE_CSS_V = version(siteCssSource);
const SITE_AUTH_V = version(siteAuthSource);
const SITE_AUTH_CSS_V = version(siteAuthCssSource);
const SITE_PLAY_V = version(sitePlaySource);
const SITE_PLAY_CSS_V = version(sitePlayCssSource);
const SITE_CHAT_V = version(siteChatSource);
const SITE_PASS_V = version(sitePassSource);
/** Pack Pass frames + emote picker helper (public/site/js/cardbit-site-pass.js). Loads before the scripts that draw avatars. */
export const passTag = () => `<script>window.cardbitPass=${passClientJson()}</script><script src="/site/js/cardbit-site-pass.js?v=${SITE_PASS_V}" defer></script>`;
const SITE_LIVE_PULLS_V = version(siteLivePullsSource);
const SITE_LIVE_PULLS_CSS_V = version(siteLivePullsCssSource);
const SITE_DECODE_V = version(siteDecodeSource);
const SITE_DECODE_CSS_V = version(siteDecodeCssSource);
/** Sideways (landscape) card scans shown upright everywhere (Trevor, Nov 25 2026). */
const SITE_UPRIGHT_V = version(siteUprightSource);
/** Signal Decode opening (Trevor approved Nov 25 2026). SITE_DECODE=off falls back to the previous player. */
const decodeOn = () => process.env.SITE_DECODE !== "off";
const SITE_CHAT_CSS_V = version(siteChatCssSource);
const SITE_PULSE_V = version(sitePulseSource);
const SITE_ADS_V = version(siteAdsSource);

/** Ad pixel IDs from Railway variables (Trevor 2026-11-25: Meta, TikTok, Google Ads). Malformed values are ignored. */
export function adPixels(env: NodeJS.ProcessEnv = process.env) {
  const pick = (v: string | undefined, re: RegExp) => (v && re.test(v.trim()) ? v.trim() : "");
  return {
    meta: pick(env.CARDBIT_SITE_META_PIXEL_ID, /^\d{6,20}$/),
    tiktok: pick(env.CARDBIT_SITE_TIKTOK_PIXEL_ID, /^[A-Z0-9]{10,30}$/i),
    gads: pick(env.CARDBIT_SITE_GOOGLE_ADS_ID, /^AW-\d{6,15}$/),
    gadsPurchase: pick(env.CARDBIT_SITE_GOOGLE_ADS_PURCHASE_LABEL, /^[A-Za-z0-9_-]{4,40}$/),
    gadsLead: pick(env.CARDBIT_SITE_GOOGLE_ADS_LEAD_LABEL, /^[A-Za-z0-9_-]{4,40}$/),
  };
}

/** Consent banner + ad pixels (public/site/js/cardbit-site-ads.js). Left out entirely until a pixel ID is set. */
export function adsTag(env: NodeJS.ProcessEnv = process.env) {
  const p = adPixels(env);
  if (!p.meta && !p.tiktok && !p.gads) return "";
  return `<script src="/site/js/cardbit-site-ads.js?v=${SITE_ADS_V}" data-meta="${p.meta}" data-tiktok="${p.tiktok}" data-gads="${p.gads}" data-gads-purchase="${p.gadsPurchase}" data-gads-lead="${p.gadsLead}" defer></script>`;
}

/** First-party analytics beacon (Card Broker Analytics tab) plus the ad consent script. Every customer page includes it. */
export const pulseTag = () => `<script src="/site/js/cardbit-site-pulse.js?v=${SITE_PULSE_V}" defer></script>${adsTag()}`;

export const SITE_ENABLED = () => process.env.CARDBIT_SITE === "on";

export function assetUrl(name: string): string {
  const hash = files[name];
  if (!hash) throw new Error(`Cardbit site asset missing from manifest: ${name}`);
  return `/site/assets/${name}?v=${hash}`;
}

const escapeAttr = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// Script order matches layout/cardbit-dark.liquid; every script is deferred, so they run in order.
export const STYLES = [
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
  "cardbit-portfolio.css",
  "cardbit-welcome.css",
  "cardbit-giveaway-entry.css",
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
  "WELCOME",
  "cardbit-storefront.js",
  "cardbit-rewards-nav.js",
  "cardbit-market-chart.js",
  "PORTFOLIO",
];

function assetMap(): string {
  // window.cardbitAssets: theme files keyed without the "cardbit-" prefix, as the storefront expects.
  const map: Record<string, string> = {};
  for (const name of Object.keys(files)) {
    if (/\.(?:webp|png|jpe?g|svg|mp4|wav)$/i.test(name)) map[name.replace(/^cardbit-/, "")] = assetUrl(name);
  }
  return JSON.stringify(map).replace(/</g, "\\u003c");
}

const ICON_IDS = ["latch", "blazebit", "driplink", "mossbit", "zappix", "cryobyte", "glitchog", "phantab", "nimbyte", "wyrmware", "latch-gold", "latch-holo"];
function rewardIcons(): string {
  // Latch & Friends icons for the header Rewards badge (same files as the Rewards page).
  const map: Record<string, string> = {};
  for (const id of ICON_IDS) map[id] = assetUrl(`cardbit-icon-${id}${id.startsWith("latch") ? ".webp" : ".svg"}`);
  Object.assign(map, PASS_ICON_URLS); // Pack Pass emotes (site only)
  return JSON.stringify(map).replace(/</g, "\\u003c");
}

/** Link previews (Open Graph / X cards). Banners: public/site/share/, made by scripts/site/share-banners.mjs. */
export type Share = { title: string; description: string; image?: string; path?: string };
export const HOME_SHARE: Share = {
  title: "cardbit · Digital Packs, Real Pokémon Cards",
  description: "Open Pokémon packs online. Every pull is a real card you can keep in your vault, ship to your door or sell back for Cardbits.",
  image: "cardbit-share.png",
  path: "/",
};
export function shareMeta(share: Share, env: NodeJS.ProcessEnv = process.env): string {
  let origin = "https://cardbit.com";
  try { if (env.SITE_ORIGIN) origin = new URL(env.SITE_ORIGIN).origin; } catch { /* keep default */ }
  const image = `${origin}/site/share/${share.image || HOME_SHARE.image}`;
  const tags: [string, string, string][] = [
    ["name", "description", share.description],
    ["property", "og:type", "website"],
    ["property", "og:site_name", "cardbit"],
    ["property", "og:title", share.title],
    ["property", "og:description", share.description],
    ["property", "og:image", image],
    ["property", "og:image:width", "1200"],
    ["property", "og:image:height", "630"],
    ["property", "og:image:alt", "Cardbit packs and Latch, the Cardbit mascot"],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", share.title],
    ["name", "twitter:description", share.description],
    ["name", "twitter:image", image],
  ];
  if (share.path) tags.splice(5, 0, ["property", "og:url", origin + share.path]);
  return tags.map(([k, n, v]) => `<meta ${k}="${n}" content="${escapeAttr(v)}">`).join("\n    ");
}

export interface ShellOptions {
  title?: string;
  /** Link preview for this page; the home banner when left out. */
  share?: Share;
  /** Extra data-* attributes on #cardbit-store. */
  data?: Record<string, string>;
  /** Site path of a public page ("/packs"): indexable with a canonical link. Left out = noindex. */
  indexPath?: string;
}

export function storefrontShell({ title = "cardbit · Packs and Singles", data = {}, share, indexPath }: ShellOptions = {}): string {
  const attrs: Record<string, string> = {
    id: "cardbit-store",
    "data-routing": "path",
    "data-mode": "site",
    "data-api-base": "/api",
    "data-sign-in": "/sign-in",
    "data-topup-checkout": "/checkout/cardbits",
    "data-sign-in-providers": signInProviders().join(","),
    "data-policy-view": "/policies",
    "data-rewards-view": "/rewards",
    "data-shelf-title": "Shop Packs",
    "data-order": "mystery,booster,gold,japanese,wildcard",
    "data-animate-header": "true",
    "data-autoplay-hero": "true",
    // Shop Packs on phones: Top Chases sit beside each pack (cardbit-site.css). Remove for the 3-card row under it.
    "data-chase-style": "beside",
    ...data,
  };
  const rootAttrs = Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeAttr(value)}"`)
    .join(" ");
  const styles = [
    ...STYLES.map((name) => `<link rel="stylesheet" href="${assetUrl(name)}">`),
    `<link rel="stylesheet" href="/site/css/cardbit-site.css?v=${SITE_CSS_V}">`,
    `<link rel="stylesheet" href="/site/css/cardbit-site-auth.css?v=${SITE_AUTH_CSS_V}">`,
    `<link rel="stylesheet" href="/site/css/cardbit-site-play.css?v=${SITE_PLAY_CSS_V}">`,
    `<link rel="stylesheet" href="/site/css/cardbit-site-live-pulls.css?v=${SITE_LIVE_PULLS_CSS_V}">`,
    ...(decodeOn() ? [`<link rel="stylesheet" href="/site/css/cardbit-site-decode.css?v=${SITE_DECODE_CSS_V}">`] : []),
    ...(chatOn() ? [`<link rel="stylesheet" href="/site/css/cardbit-site-chat.css?v=${SITE_CHAT_CSS_V}">`] : []),
  ].join("\n    ");
  const scripts = SCRIPTS.map((name) =>
    name === "SITE_STORE"
      ? `<script src="/site/js/cardbit-site-store.js?v=${SITE_STORE_V}" defer></script>`
      : name === "WELCOME"
        ? `<script src="${assetUrl("cardbit-welcome.js")}" data-cardbit-welcome data-endpoint="/api/welcome" data-policies="/policies" defer></script>`
        : name === "PORTFOLIO"
        ? `<script src="${assetUrl("cardbit-portfolio.js")}" data-portfolio-endpoint="/api/portfolio" defer></script>`
        : `<script src="${assetUrl(name)}" defer></script>`,
  ).join("\n    ") + `\n    <script src="/site/js/cardbit-site-auth.js?v=${SITE_AUTH_V}" defer></script>` +
    `\n    <script src="/site/js/cardbit-site-play.js?v=${SITE_PLAY_V}" defer></script>` +
    `\n    <script src="/site/js/cardbit-site-upright.js?v=${SITE_UPRIGHT_V}" defer></script>` +
    `\n    <script src="/site/js/cardbit-site-live-pulls.js?v=${SITE_LIVE_PULLS_V}" data-back="${assetUrl("cardbit-card-back-en.webp")}" defer></script>` +
    (decodeOn() ? `\n    <script src="/site/js/cardbit-site-decode.js?v=${SITE_DECODE_V}" data-bits="${assetUrl("cardbit-bits-card-emblem.png")}" data-music="/site/audio/cardbit-opening-music.mp3?v=ttt1" defer></script>` : "") +
    (chatOn() ? `\n    <script src="/site/js/cardbit-site-chat.js?v=${SITE_CHAT_V}" defer></script>` : "") +
    (helpTags("site", assetUrl("cardbit-latch-cheer.webp")) ? `\n    ${helpTags("site", assetUrl("cardbit-latch-cheer.webp"))}` : "");

  return `<!doctype html>
<html lang="en"${decodeOn() ? "" : ' data-cb-decode="off"'}>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#101619">
    ${robotsTags(indexPath ?? null)}
    <meta name="referrer" content="same-origin">
    <title>${escapeAttr(title)}</title>
    ${shareMeta(share ?? { ...HOME_SHARE, title })}
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
      window.CardbitRewardIcons = ${rewardIcons()};
      window.cardbitPlan = ${planClientJson()};
    </script>
    ${passTag()}
    ${protectionScript()}
    ${scripts}
    ${pulseTag()}
  </head>
  <body>
    <div ${rootAttrs}>
      <div class="cb-loading" role="status" aria-live="polite">
        <img src="${assetUrl("cardbit-brand-lockup.webp")}" width="158" height="32" alt="cardbit">
        <p>Loading the Card Shop…</p>
      </div>
    </div>
    <noscript><p>Enable JavaScript to Browse the Cards or Open a Pack.</p><a href="mailto:Support@cardbit.com">Support@cardbit.com</a></noscript>
    ${withPlanCopy(howItWorks, subscriptionsReady())}
    ${giveaway.replace(/src="\/site\/assets\/([^"?]+)"/g, (m, name) => (files[name] ? `src="${assetUrl(name)}"` : m))}
  </body>
</html>`;
}

/** Browser hardening for every standalone-site page. Kept compatible with the inline scripts, Coinflow's
 *  device script and Stripe/Coinflow redirects: no script-src rules, only framing, plugins and base URL. */
export const SITE_SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000",
  "Content-Security-Policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=(self)",
};

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...SITE_SECURITY_HEADERS },
  });
}

export const notFound = () => new Response("Not Found", { status: 404 });
