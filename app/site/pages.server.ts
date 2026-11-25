/**
 * Cardbit standalone site: standalone (non-storefront) pages, ported from the theme.
 */
import policies from "./partials/policies.html?raw";
import { assetUrl } from "./shell.server";

// Official Rules are a counsel-review draft (Nov 24 2026) and are not committed. Drop the approved
// HTML body at app/site/partials/official-rules.html to publish it at /official-rules.
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
