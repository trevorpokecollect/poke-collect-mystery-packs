import type { LoaderFunctionArgs } from "react-router";
import { oddsFromQuery } from "../lib/pool-page.server";
import { proxyContext } from "../lib/proxy.server";

// "Potential Pulls" page, rendered inside the store theme at /apps/packs/pool?product=<id>.
// Every card in the pool with its tier, copies left and current odds. Never card values.

const TIER_COLORS: Record<string, string> = {
  poke: "#e3350d",
  great: "#2f6fe0",
  ultra: "#d49a00",
  master: "#8b46e0",
  chase: "#d49a00",
  epic: "#8b46e0",
  rare: "#2f6fe0",
  uncommon: "#2fa36b",
  base: "#6b6b76",
};

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
// Shopify Liquid would read {{ or {% in card titles as code.
const safe = (s: string) => escape(s).replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
const pct = (n: number) => (n === 0 ? "0%" : n < 0.001 ? "<0.1%" : `${(n * 100).toFixed(1)}%`);
const tierColor = (tier: string) => TIER_COLORS[tier.trim().toLowerCase()] ?? "#6b6b76";
const thumb = (url: string) => (url.includes("cdn.shopify.com") ? `${url}${url.includes("?") ? "&" : "?"}width=360` : url);

const STYLE = `
.mpp { max-width: 1180px; margin: 0 auto; padding: 32px 16px 64px; }
.mpp h1 { margin: 0 0 6px; }
.mpp-sub { margin: 0 0 20px; opacity: .75; }
.mpp-tiers { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 28px; }
.mpp-tier { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; border: 1px solid rgba(0,0,0,.12); font-weight: 600; }
.mpp-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
.mpp-tier small { opacity: .7; font-weight: 500; }
.mpp-section { margin: 28px 0 12px; display: flex; align-items: baseline; gap: 10px; }
.mpp-section h2 { margin: 0; font-size: 1.25rem; }
.mpp-section span { opacity: .7; }
.mpp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 16px; }
.mpp-card { border: 1px solid rgba(0,0,0,.1); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 6px; background: rgba(255,255,255,.6); }
.mpp-card img { width: 100%; aspect-ratio: 5 / 7; object-fit: contain; border-radius: 8px; background: #f3f3f6; }
.mpp-name { font-size: .85rem; font-weight: 600; line-height: 1.25; }
.mpp-meta { display: flex; justify-content: space-between; font-size: .8rem; opacity: .85; }
.mpp-badge { font-size: .7rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.mpp-out { opacity: .45; }
.mpp-out .mpp-meta strong { text-decoration: line-through; }
.mpp-fair { margin-top: 32px; font-size: .78rem; opacity: .7; word-break: break-all; }
.mpp-back { display: inline-block; margin-bottom: 18px; }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, liquid } = await proxyContext(request);
  const url = new URL(request.url);
  const odds = await oddsFromQuery(shop, url);
  const product = url.searchParams.get("product");
  const back = product
    ? `<a class="mpp-back" href="javascript:history.back()">&larr; Back to the pack</a>`
    : "";

  if (!odds) {
    return liquid(
      `<div class="mpp"><style>${STYLE}</style>${back}<h1>Potential Pulls</h1>
       <p class="mpp-sub">This pack's card list isn't available yet.</p></div>`,
    );
  }

  const closed = odds.status === "CLOSED";
  const tierChips = odds.tiers
    .map(
      (t) => `<div class="mpp-tier"><span class="mpp-dot" style="background:${tierColor(t.name)}"></span>${safe(t.name)}
        <small>${closed ? `${t.total} cards` : pct(t.currentOdds)}</small></div>`,
    )
    .join("");

  const sections = odds.tiers
    .map((t) => {
      const cards = odds.cards
        .filter((c) => c.tier === t.name)
        .sort((a, b) => b.remaining - a.remaining || a.title.localeCompare(b.title));
      const items = cards
        .map((c) => {
          const out = c.remaining === 0;
          return `<div class="mpp-card${out ? " mpp-out" : ""}">
            ${c.imageUrl ? `<img src="${safe(thumb(c.imageUrl))}" alt="${safe(c.title)}" loading="lazy">` : ""}
            <div class="mpp-badge" style="color:${tierColor(c.tier)}">${safe(c.tier)}</div>
            <div class="mpp-name">${safe(c.title)}</div>
            <div class="mpp-meta"><strong>${closed ? "" : out ? "Pulled" : pct(c.currentOdds)}</strong>
              <span>${c.remaining} of ${c.quantity} left</span></div>
          </div>`;
        })
        .join("");
      return `<div class="mpp-section"><h2 style="color:${tierColor(t.name)}">${safe(t.name)}</h2>
        <span>${t.remaining} of ${t.total} left${closed ? "" : ` · ${pct(t.currentOdds)} per pack`}</span></div>
        <div class="mpp-grid">${items}</div>`;
    })
    .join("");

  const fairness = odds.commitHash
    ? `<p class="mpp-fair">${
        odds.reveal
          ? `Fairness check: sha256("${safe(odds.reveal.salt ?? "")}:" + the published card order) = ${safe(odds.commitHash)}`
          : `The order of every card in this pool was locked before the first pack was sold. Fingerprint: ${safe(odds.commitHash)}`
      }</p>`
    : "";

  return liquid(
    `<div class="mpp"><style>${STYLE}</style>${back}
      <h1>Potential Pulls: ${safe(odds.title)}</h1>
      <p class="mpp-sub">${
        closed
          ? "This series is sold out."
          : `Every pack holds one of these cards. ${odds.packsRemaining} of ${odds.totalPacks} packs left. Odds update as packs are opened.`
      }</p>
      <div class="mpp-tiers">${tierChips}</div>
      ${sections}
      ${fairness}
    </div>`,
  );
};
