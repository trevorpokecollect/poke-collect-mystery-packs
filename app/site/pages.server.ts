/**
 * Cardbit standalone site: standalone (non-storefront) pages, ported from the theme.
 */
import policies from "./partials/policies.html?raw";
import { robotsTags } from "./seo.server";
import { STYLES, SITE_CSS_V, appNavTags, assetUrl, shareMeta, pulseTag, passTag } from "./shell.server";
import rewardsIn from "./partials/rewards-in.html?raw";
import { withPassIconUrls } from "./play/pass-icons";
import { planClientJson, withPlanCopy } from "./play/plan-brand";
import { subscriptionsReady } from "./payments/coinflow-subscriptions.server";
import rewardsOut from "./partials/rewards-out.html?raw";
import leaderboardIn from "./partials/leaderboard-in.html?raw";
import leaderboardOut from "./partials/leaderboard-out.html?raw";

// Official Rules body (Trevor approved showing it, Nov 24 2026). Source: the rules thread's
// official-rules-page.html with the draft banner and counsel review notes removed.
const optional = import.meta.glob("./partials/official-rules.html", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const officialRules = optional["./partials/official-rules.html"] ?? null;

function page(title: string, description: string, body: string, styles: string[], path: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#0b0f17">
    ${robotsTags(path)}
    <meta name="referrer" content="same-origin">
    <title>${title} · cardbit</title>
    ${shareMeta({ title: `${title} · cardbit`, description })}
    <link rel="icon" type="image/png" href="${assetUrl("cardbit-brand-emblem.png")}">
    ${styles.map((name) => `<link rel="stylesheet" href="${assetUrl(name)}">`).join("\n    ")}
    ${styles.includes("cardbit-storefront.css") ? `<link rel="stylesheet" href="/site/css/cardbit-site.css?v=${SITE_CSS_V}">` : ""}
    <style>body{margin:0;background:#101619;color:#f6faf9}</style>
    ${pulseTag()}
    ${styles.includes("cardbit-storefront.css") ? appNavTags() : ""}
  </head>
  <body>${body}</body>
</html>`;
}

export function policiesPage(): string {
  return page(
    "Policies",
    "Cardbit Terms of Service, Refund, Shipping and Privacy policies: Cardbits, packs, vault storage, buybacks and shipping.",
    withPlanCopy(policies, subscriptionsReady()),
    ["cardbit-policy-page.css"],
    "/policies",
  );
}

/** `spinPrizes` is Official Rules C4 drawn from the live Daily Spin prize table (rewards/spin-rules.server.ts). */
export function officialRulesPage(spinPrizes = ""): string | null {
  if (!officialRules) return null;
  // Site header and footer around the Policies page's legal type, so the rules read like the approved legal pages.
  const body = `<div id="cardbit-store" data-mode="site" class="cb-standalone">${siteHeader()}
<div class="cbp" id="cbp"><main class="cbp-frame cbp-legal" id="cbp-main" tabindex="-1"><p class="cbp-crumb"><a href="/policies">All Policies</a></p><h1>Official Rules</h1><div class="cbp-legal-body">${officialRules.replace("<!--spin-prizes-->", spinPrizes)}</div></main></div>
${siteFooter()}</div>${walletScript}`;
  return page("Official Rules", "Official Rules for Cardbit's Daily Giveaway, Daily Spinner and Weekly Leaderboard.", body, [...STYLES, "cardbit-policy-page.css"], "/official-rules");
}

// Same header and footer the storefront draws (cardbit-storefront.js header()/footer()), for pages served outside it.
const navLink = (to: string, label: string, current: string) =>
  `<a class="cb-navlink" href="/${to}"${current === to ? ' aria-current="page"' : ""}><span class="cb-nav-icon cb-nav-${to}" aria-hidden="true"></span><span>${label}</span></a>`;
const userIcon = '<svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c1-5 5-7 9-7s8 2 9 7m-5-14a4 4 0 1 1-8 0 4 4 0 0 1 8 0"/></svg>';
export function siteHeader(current = ""): string {
  return `<a href="#cbp-main" class="cb-skip">Skip to Content</a><header class="cb-header"><div class="cb-wrap cb-head">` +
    `<a class="cb-brand" href="/" aria-label="Cardbit Home"><span class="cb-lockup"><img class="cb-logo-exact" alt="" src="${assetUrl("cardbit-brand-lockup.webp")}"></span></a>` +
    `<nav aria-label="Shop" class="cb-nav">${navLink("packs", "Packs", current)}${navLink("chase", "Top Hits", current)}${navLink("shop", "Card Shop", current)}${navLink("help", "How It Works", current)}${navLink("pass", "Pack Pass", current).replace('class="cb-navlink"', 'class="cb-navlink cb-nav-passlink"')}</nav>` +
    `<nav aria-label="Account" class="cb-account"><a class="cb-wallet-link" href="/cardbits" aria-label="Buy Cardbits"><span class="cb-buy-label">Buy Cardbits</span><span class="cb-balance"><img alt="" width="19" height="19" style="object-fit:contain" src="${assetUrl("cardbit-bits-card-emblem.png")}"><span data-wallet-balance>0</span></span></a>` +
    `<a class="cb-sparks-link" href="/sparks" aria-label="Sparks" hidden><img alt="" width="20" height="20" src="${assetUrl("cardbit-sparks.svg")}"><span data-sparks-balance>0</span></a>` +
    `<a class="cb-binder-link" aria-label="My Account" href="/account">${userIcon}<span>My Account</span></a></nav></div></header>`;
}
const DISCORD_LINK = '<div class="cb-foot-socials"><a class="cb-foot-social" href="https://discord.gg/F9Z6jbgj4Y" target="_blank" rel="noopener" aria-label="Join Our Discord (opens in a new tab)"><svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18.2 18.2 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.7 19.7 0 0 0 6 3l1.3-2.1a12.8 12.8 0 0 1-2-1l.5-.4a14 14 0 0 0 12.2 0l.5.4a12.8 12.8 0 0 1-2 1l1.3 2.1a19.6 19.6 0 0 0 6-3c.5-5.2-.9-9.7-3.6-13.7ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg><span>Join Our Discord</span></a><a class="cb-foot-social cb-foot-facebook" href="https://www.facebook.com/cardbitshop" target="_blank" rel="noopener" aria-label="Follow Cardbit on Facebook (opens in a new tab)"><svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12Z"/></svg><span>Facebook</span></a><a class="cb-foot-social cb-foot-instagram" href="https://www.instagram.com/cardbitshop" target="_blank" rel="noopener" aria-label="Follow Cardbit on Instagram (opens in a new tab)"><svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6" fill="currentColor"/></svg><span>Instagram</span></a><a class="cb-foot-social cb-foot-whatnot" href="https://whatnot.com/invite/pokecollectcards" target="_blank" rel="noopener" aria-label="Join Whatnot and Get a $25 Credit (opens in a new tab)"><img class="cb-foot-logo" alt="" width="18" height="18" src="'+assetUrl("cardbit-giveaway-whatnot.png")+'"><span>Whatnot</span><b class="cb-foot-badge">Get $25 Credit</b></a></div>';
export function siteFooter(): string {
  return `<footer class="cb-footer"><div class="cb-wrap"><div class="cb-foot-main"><div><img alt="cardbit" width="135" height="27" src="${assetUrl("cardbit-brand-lockup.webp")}"><p>Hosted by Poke-Collect</p></div>` +
    `<nav aria-label="Footer"><a href="/packs">Browse Packs</a><a href="/chase">Top Hits</a><a href="/ship-together">Ship Together</a><a href="/shop">Card Shop</a><a href="/help">How It Works</a><a href="/pass">Pack Pass</a><a href="/rewards">Rewards</a><a href="/sparks">Spark Shop</a><a href="/policies">Policies</a><a href="mailto:Support@cardbit.com">Contact Us</a></nav></div>` +
    `<div class="cb-foot-end"><span>Cardbit, LLC · Madison, Alabama</span>${DISCORD_LINK}</div></div></footer>`;
}
// Fills the header wallet from the signed-in account (0 when signed out).
const walletScript = `<script>fetch("/api/store/state",{credentials:"same-origin",headers:{Accept:"application/json"}}).then(r=>r.ok?r.json():null).then(s=>{const b=s&&s.account?Number(s.account.bits):0;for(const el of document.querySelectorAll("[data-wallet-balance]"))el.textContent=b.toLocaleString("en-US");const sp=s&&s.account?s.account.sparks:null,pill=document.querySelector(".cb-sparks-link");if(pill&&sp!=null){const v=Number(sp).toLocaleString("en-US");pill.querySelector("[data-sparks-balance]").textContent=v;pill.setAttribute("aria-label","Sparks, Balance "+v);pill.hidden=false}const a=document.querySelector(".cb-wallet-link");if(a)a.setAttribute("aria-label","Buy Cardbits, Balance "+b.toLocaleString("en-US")+" Cardbits")}).catch(()=>{})</script>`;
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
  const body = withChrome(member(withPassIconUrls(customer ? rewardsIn : rewardsOut), customer)) + walletScript + (customer ? `<script>window.cardbitPlan=${planClientJson()}</script>` + passTag() + script("cardbit-rewards.js") : "");
  return page("Rewards", "Cardbit Rewards: levels, XP, daily check-in streaks, free Daily Spins and BitBot icons.", body, rewardStyles, "/rewards");
}

export function leaderboardPage(customer: { name: string | null; email: string } | null): string {
  const body = withChrome(member(withPassIconUrls(customer ? leaderboardIn : leaderboardOut), customer)) + walletScript + `<script>window.cardbitPlan=${planClientJson()}</script>` + passTag() + script("cardbit-leaderboard.js");
  return page("Leaderboard", "Cardbit Weekly Leaderboard: the top collectors this week.", body, rewardStyles, "/leaderboard");
}

// ---------- Spark Shop (Trevor, Nov 26 2026): cardbit.com/sparks ----------
type SparkCard = { key: string; title: string; set: string; number: string; finish: string; language: string; condition: string; image: string | null; tier: string | null; sparks: number; left: number };
export type SparkShopView = {
  open: boolean;
  signedIn: boolean;
  balance: number | null;
  cards: SparkCard[];
  confirm?: SparkCard | null;
  requestId?: string;
  notice?: { kind: "ok" | "err"; text: string; link?: { href: string; label: string } } | null;
};
const fmtN = (n: number) => n.toLocaleString("en-US");
const SPARK_CSS = `<style>
.sx{max-width:1180px;margin:0 auto;padding:28px 16px 64px}
.sx-hero{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:18px;padding:24px;border:1px solid #23474b;border-radius:20px;background:radial-gradient(600px 220px at 15% 0%,#0f3f42 0%,#121b1e 70%)}
.sx-hero h1{font:800 clamp(1.9rem,4vw,2.6rem)/1.05 'Cardbit Outfit',system-ui,sans-serif;margin:0 0 6px;display:flex;align-items:center;gap:10px}
.sx-hero p{margin:0;color:#b6c4c5;max-width:560px}
.sx-bal{display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:14px;background:#0c1416;border:1px solid #2b4448}
.sx-bal b{font:800 1.6rem/1 'Cardbit Outfit',system-ui,sans-serif}.sx-bal span{color:#b6c4c5;font-size:.85rem;display:block}
.sx-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:12px;border:0;background:#00e6e1;color:#092022;font:800 1rem 'Cardbit Outfit',system-ui,sans-serif;text-decoration:none;cursor:pointer}
.sx-btn.alt{background:#13262a;color:#f6faf9;border:1px solid #2b4448}.sx-btn[aria-disabled=true]{background:#1b2a2d;color:#8fa0a3;cursor:not-allowed}
.sx-earn{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:16px 0 0;padding:0;list-style:none}
.sx-earn li{padding:12px 14px;border-radius:14px;background:#121b1e;border:1px solid #20383c;color:#d3dbe0;font-size:.92rem}.sx-earn b{display:block;color:#f6faf9;font-family:'Cardbit Outfit',system-ui,sans-serif}
.sx-note{margin:18px 0 0;padding:12px 14px;border-radius:12px;border:1px solid #2f6f6c;background:#0e2a2b}.sx-note.err{border-color:#ff6b6b66;background:#ff6b6b14;color:#ffd0d0}
.sx-confirm{margin:18px 0 0;display:flex;flex-wrap:wrap;gap:16px;align-items:center;padding:18px;border-radius:18px;border:1px solid #00e6e1;background:#0e2224}
.sx-confirm img{width:96px;height:auto;border-radius:8px}.sx-confirm h2{margin:0 0 4px;font:800 1.25rem 'Cardbit Outfit',system-ui,sans-serif}.sx-confirm p{margin:0;color:#b6c4c5}
.sx-confirm form{display:flex;gap:10px;flex-wrap:wrap;margin-left:auto}
.sx-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:30px 0 12px}.sx-head h2{margin:0;font:800 1.35rem 'Cardbit Outfit',system-ui,sans-serif}.sx-head span{color:#8fa0a3}
.sx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:14px;margin:0;padding:0;list-style:none}
.sx-card{display:flex;flex-direction:column;border-radius:16px;background:#121b1e;border:1px solid #20383c;overflow:hidden}
.sx-art{aspect-ratio:5/7;background:#0b1214;display:grid;place-items:center;padding:10px}.sx-art img{width:100%;height:100%;object-fit:contain}
.sx-art .sx-ph{color:#4d6366;font:800 .9rem 'Cardbit Outfit',system-ui,sans-serif;text-align:center}
.sx-body{display:flex;flex-direction:column;gap:4px;padding:10px 12px 12px;flex:1}
.sx-body h3{margin:0;font:800 .98rem/1.2 'Cardbit Outfit',system-ui,sans-serif}.sx-body small{color:#8fa0a3}
.sx-price{display:flex;align-items:center;gap:6px;margin-top:auto;padding-top:8px;font:800 1.05rem 'Cardbit Outfit',system-ui,sans-serif}
.sx-card .sx-btn{margin-top:8px;width:100%}
.sx-tier{align-self:flex-start;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:999px;background:#13262a;color:#73e6dc}
.sx-empty{padding:40px 16px;text-align:center;border:1px dashed #2b4448;border-radius:18px;color:#b6c4c5}
p.sx-fine{margin:28px 0 0;color:#8fa0a3;font-size:.85rem}p.sx-fine a{color:#5fe3ec}
.sx :focus-visible{outline:2px solid #00e6e1;outline-offset:2px}
@media (max-width:560px){.sx-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.sx-hero{padding:18px}.sx-confirm form{margin-left:0;width:100%}.sx-confirm form .sx-btn{flex:1}}
</style>`;

export function sparkShopPage(v: SparkShopView): string {
  const spark = (size: number) => `<img alt="" width="${size}" height="${size}" src="${assetUrl("cardbit-sparks.svg")}">`;
  const card = (c: SparkCard) => {
    const short = v.signedIn && v.balance != null && v.balance < c.sparks;
    const action = !v.signedIn
      ? `<a class="sx-btn alt" href="/sign-in?return_to=${encodeURIComponent("/sparks")}">Sign In to Redeem</a>`
      : short
        ? `<span class="sx-btn" aria-disabled="true">Need ${fmtN(c.sparks - (v.balance ?? 0))} More</span>`
        : `<a class="sx-btn" href="/sparks?card=${c.key}#sx-confirm" aria-label="Redeem ${escapeHtml(c.title)} for ${fmtN(c.sparks)} Sparks">Redeem</a>`;
    return `<li class="sx-card"><div class="sx-art">${c.image ? `<img src="${escapeHtml(c.image)}" alt="${escapeHtml(c.title)}" loading="lazy" width="245" height="342">` : `<span class="sx-ph">${escapeHtml(c.title)}</span>`}</div>` +
      `<div class="sx-body">${c.tier ? `<span class="sx-tier">${escapeHtml(c.tier)}</span>` : ""}<h3>${escapeHtml(c.title)}</h3><small>${escapeHtml(c.set)} · ${escapeHtml(c.condition)}${c.language !== "English" ? " · " + escapeHtml(c.language) : ""}</small>` +
      `<small>${c.left === 1 ? "1 Left" : fmtN(c.left) + " Left"}</small><div class="sx-price">${spark(20)}${fmtN(c.sparks)} Sparks</div>${action}</div></li>`;
  };
  const notice = v.notice
    ? `<p class="sx-note${v.notice.kind === "err" ? " err" : ""}" role="${v.notice.kind === "err" ? "alert" : "status"}">${escapeHtml(v.notice.text)}${v.notice.link ? ` <a href="${escapeHtml(v.notice.link.href)}">${escapeHtml(v.notice.link.label)}</a>` : ""}</p>`
    : "";
  const confirm = v.confirm && v.requestId
    ? `<section class="sx-confirm" id="sx-confirm" aria-labelledby="sx-confirm-h">${v.confirm.image ? `<img src="${escapeHtml(v.confirm.image)}" alt="" width="96" height="134">` : ""}<div><h2 id="sx-confirm-h">Redeem ${escapeHtml(v.confirm.title)}?</h2><p>${fmtN(v.confirm.sparks)} Sparks · ${escapeHtml(v.confirm.condition)}. It goes straight to My Vault.</p></div>` +
      `<form method="post"><input type="hidden" name="card" value="${v.confirm.key}"><input type="hidden" name="sparks" value="${v.confirm.sparks}"><input type="hidden" name="requestId" value="${escapeHtml(v.requestId)}"><button class="sx-btn">Redeem for ${fmtN(v.confirm.sparks)} Sparks</button><a class="sx-btn alt" href="/sparks">Cancel</a></form></section>`
    : "";
  const balance = v.signedIn && v.balance != null
    ? `<div class="sx-bal">${spark(34)}<div><b>${fmtN(v.balance)}</b><span>Your Sparks</span></div></div>`
    : v.signedIn ? "" : `<a class="sx-btn" href="/sign-in?return_to=${encodeURIComponent("/sparks")}">Sign In</a>`;
  const list = !v.open
    ? `<div class="sx-empty"><p><b>The Spark Shop Opens Soon.</b></p><p>Keep earning Sparks. You'll be able to spend them here on real cards.</p></div>`
    : v.cards.length
      ? `<ul class="sx-grid">${v.cards.map(card).join("")}</ul>`
      : `<div class="sx-empty"><p><b>The Spark Shop Is Restocking.</b></p><p>New cards are added regularly. Your Sparks stay in your account until you spend them.</p></div>`;
  const body = `<div id="cardbit-store" data-mode="site" class="cb-standalone">${siteHeader()}<main class="sx" id="cbp-main" tabindex="-1">
<section class="sx-hero"><div><h1>${spark(40)}Spark Shop</h1><p>Trade your Sparks for real cards. Prices are about <b>500 Sparks for every $1</b> of card value, and each card ships from our vault like any other.</p></div>${balance}</section>
<ul class="sx-earn"><li><b>Low Pulls Earn Sparks</b>When a paid pack's cards are worth less than you paid, you get 5% of the difference.</li><li><b>Daily Spins</b>Free spins on the <a href="/rewards">Rewards</a> page can land on Sparks.</li><li><b>Pack Pass Bonus</b><a href="/pass">Pack Pass</a> members earn extra Sparks on paid packs.</li></ul>
${notice}${confirm}
<div class="sx-head"><h2>Cards Available</h2><span>${v.open ? fmtN(v.cards.reduce((a, c) => a + c.left, 0)) + " Cards" : ""}</span></div>
${list}
<p class="sx-fine">Sparks have no cash value, can't be transferred and are spent only here. Prices follow each card's current Cardbit price, so they can change; you always see the price before you redeem. A redeemed card goes to My Vault, where you can keep it, ship it or sell it back like any other card. <a href="/help#hiw-sparks">How Sparks Work</a> · <a href="/policies">Policies</a></p>
</main>${siteFooter()}</div>${walletScript}`;
  return page("Spark Shop", "Spend Sparks on real trading cards in the Cardbit Spark Shop. About 500 Sparks for every $1 of card value.", SPARK_CSS + body, STYLES, "/sparks");
}
