/**
 * Cardbit standalone site: standalone (non-storefront) pages, ported from the theme.
 */
import policies from "./partials/policies.html?raw";
import { STYLES, assetUrl } from "./shell.server";
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
  // Reuses the Policies page frame and type so the rules match the approved legal pages.
  const body = `<div class="cbp" id="cbp"><header class="cbp-top"><div class="cbp-frame cbp-bar">
<a class="cbp-home" href="/" aria-label="Cardbit home"><img src="${assetUrl("cardbit-brand-lockup.webp")}" width="132" height="44" alt="cardbit"></a>
<a class="cbp-return" href="/policies">All Policies</a></div></header>
<main class="cbp-frame cbp-legal" id="cbp-main"><h1>Official Rules</h1><div class="cbp-legal-body">${officialRules}</div></main></div>`;
  return page("Official Rules", "Official Rules for Cardbit's Daily Giveaway, Daily Spinner and Weekly Leaderboard.", body, ["cardbit-policy-page.css"]);
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
  const body = member(customer ? rewardsIn : rewardsOut, customer) + (customer ? script("cardbit-rewards.js") : "");
  return page("Rewards", "Cardbit Rewards: levels, XP, daily check-in streaks, free Daily Spins and Latch & Friends icons.", body, rewardStyles);
}

export function leaderboardPage(customer: { name: string | null; email: string } | null): string {
  const body = member(customer ? leaderboardIn : leaderboardOut, customer) + script("cardbit-leaderboard.js");
  return page("Leaderboard", "Cardbit Weekly Leaderboard: the top collectors this week.", body, rewardStyles);
}
