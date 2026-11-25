/**
 * Cardbit standalone site: standalone (non-storefront) pages, ported from the theme.
 */
import policies from "./partials/policies.html?raw";
import { STYLES, SITE_CSS_V, assetUrl } from "./shell.server";
import rewardsIn from "./partials/rewards-in.html?raw";
import rewardsOut from "./partials/rewards-out.html?raw";
import leaderboardIn from "./partials/leaderboard-in.html?raw";
import leaderboardOut from "./partials/leaderboard-out.html?raw";

// Official Rules body (Trevor approved showing it, Nov 24 2026). Source: the rules thread's
// official-rules-page.html with the draft banner and counsel review notes removed.
const optional = import.meta.glob("./partials/official-rules.html", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const officialRules = optional["./partials/official-rules.html"] ?? null;

function page(title: string, description: string, body: string, styles: string[]): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#0b0f17">
    <meta name="referrer" content="same-origin">
    <title>${title} · cardbit</title>
    <meta name="description" content="${description}">
    <link rel="icon" type="image/png" href="${assetUrl("cardbit-brand-emblem.png")}">
    ${styles.map((name) => `<link rel="stylesheet" href="${assetUrl(name)}">`).join("\n    ")}
    ${styles.includes("cardbit-storefront.css") ? `<link rel="stylesheet" href="/site/css/cardbit-site.css?v=${SITE_CSS_V}">` : ""}
    <style>body{margin:0;background:#101619;color:#f6faf9}</style>
  </head>
  <body>${body}</body>
</html>`;
}

export function policiesPage(): string {
  return page(
    "Policies",
    "Cardbit Terms of Service, Refund, Shipping and Privacy policies: Cardbits, packs, vault storage, buybacks and shipping.",
    policies,
    ["cardbit-policy-page.css"],
  );
}

export function officialRulesPage(): string | null {
  if (!officialRules) return null;
  // Site header and footer around the Policies page's legal type, so the rules read like the approved legal pages.
  const body = `<div id="cardbit-store" data-mode="site" class="cb-standalone">${siteHeader()}
<div class="cbp" id="cbp"><main class="cbp-frame cbp-legal" id="cbp-main" tabindex="-1"><p class="cbp-crumb"><a href="/policies">All Policies</a></p><h1>Official Rules</h1><div class="cbp-legal-body">${officialRules}</div></main></div>
${siteFooter()}</div>${walletScript}`;
  return page("Official Rules", "Official Rules for Cardbit's Daily Giveaway, Daily Spinner and Weekly Leaderboard.", body, [...STYLES, "cardbit-policy-page.css"]);
}

// Same header and footer the storefront draws (cardbit-storefront.js header()/footer()), for pages served outside it.
const navLink = (to: string, label: string, current: string) =>
  `<a class="cb-navlink" href="/${to}"${current === to ? ' aria-current="page"' : ""}><span class="cb-nav-icon cb-nav-${to}" aria-hidden="true"></span><span>${label}</span></a>`;
const userIcon = '<svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c1-5 5-7 9-7s8 2 9 7m-5-14a4 4 0 1 1-8 0 4 4 0 0 1 8 0"/></svg>';
export function siteHeader(current = ""): string {
  return `<a href="#cbp-main" class="cb-skip">Skip to Content</a><header class="cb-header"><div class="cb-wrap cb-head">` +
    `<a class="cb-brand" href="/" aria-label="Cardbit Home"><span class="cb-lockup"><img class="cb-logo-exact" alt="" src="${assetUrl("cardbit-brand-lockup.webp")}"></span></a>` +
    `<nav aria-label="Shop" class="cb-nav">${navLink("packs", "Packs", current)}${navLink("chase", "Chase", current)}${navLink("shop", "Card Shop", current)}${navLink("help", "How It Works", current)}</nav>` +
    `<nav aria-label="Account" class="cb-account"><a class="cb-wallet-link" href="/cardbits" aria-label="Buy Cardbits"><span class="cb-buy-label">Buy Cardbits</span><span class="cb-balance"><img alt="" width="19" height="19" style="object-fit:contain" src="${assetUrl("cardbit-bits-card-emblem.png")}"><span data-wallet-balance>0</span></span></a>` +
    `<a class="cb-binder-link" aria-label="My Account" href="/account">${userIcon}<span>My Account</span></a></nav></div></header>`;
}
export function siteFooter(): string {
  return `<footer class="cb-footer"><div class="cb-wrap"><div class="cb-foot-main"><div><img alt="cardbit" width="135" height="27" src="${assetUrl("cardbit-brand-lockup.webp")}"><p>Hosted by Poke-Collect</p></div>` +
    `<nav aria-label="Footer"><a href="/packs">Browse Packs</a><a href="/chase">Chase</a><a href="/ship-together">Ship Together</a><a href="/shop">Card Shop</a><a href="/help">How It Works</a><a href="/rewards">Rewards</a><a href="/policies">Policies</a><a href="mailto:Support@cardbit.com">Contact Us</a></nav></div>` +
    `<div class="cb-foot-end"><span>Cardbit, LLC · Madison, Alabama</span></div></div></footer>`;
}
// Fills the header wallet from the signed-in account (0 when signed out).
const walletScript = `<script>fetch("/api/store/state",{credentials:"same-origin",headers:{Accept:"application/json"}}).then(r=>r.ok?r.json():null).then(s=>{const b=s&&s.account?Number(s.account.bits):0;for(const el of document.querySelectorAll("[data-wallet-balance]"))el.textContent=b.toLocaleString("en-US");const a=document.querySelector(".cb-wallet-link");if(a)a.setAttribute("aria-label","Buy Cardbits, Balance "+b.toLocaleString("en-US")+" Cardbits")}).catch(()=>{})</script>`;
/** Swap a theme section's minimal header/footer for the full site header/footer. */
function withChrome(html: string): string {
  return html
    .replace(/<a class="cb-skip"[^>]*>[^<]*<\/a>\s*<header class="cb-header">[\s\S]*?<\/header>/, (m) => m.match(/<a class="cb-skip"[^>]*>[^<]*<\/a>/)![0] + siteHeader().replace(/^<a [^>]*>[^<]*<\/a>/, ""))
    .replace(/<footer class="cb-footer">[\s\S]*?<\/footer>/, siteFooter())
    .replace('<div id="cardbit-store"', '<div id="cardbit-store" data-mode="site"');
}

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Signed-in variant gets the customer's first and last name for the initials avatar. */
function member(html: string, customer: { name: string | null; email: string } | null) {
  if (!customer) return html;
  const parts = (customer.name || customer.email.split("@")[0]).trim().split(/\s+/);
  const first = parts[0] || "", last = parts.length > 1 ? parts[parts.length - 1] : "";
  return html.replace("%%FIRST%%", escapeHtml(first)).replace("%%LAST%%", escapeHtml(last));
}

const rewardStyles = [...STYLES, "cardbit-rewards.css"];
const script = (name: string) => `<script src="${assetUrl(name)}" defer></script>`;

export function rewardsPage(customer: { name: string | null; email: string } | null): string {
  const body = withChrome(member(customer ? rewardsIn : rewardsOut, customer)) + walletScript + (customer ? script("cardbit-rewards.js") : "");
  return page("Rewards", "Cardbit Rewards: levels, XP, daily check-in streaks, free Daily Spins and Latch & Friends icons.", body, rewardStyles);
}

export function leaderboardPage(customer: { name: string | null; email: string } | null): string {
  const body = withChrome(member(customer ? leaderboardIn : leaderboardOut, customer)) + walletScript + script("cardbit-leaderboard.js");
  return page("Leaderboard", "Cardbit Weekly Leaderboard: the top collectors this week.", body, rewardStyles);
}
