// Coming-soon waitlist page (cardbit.com before launch). Server-rendered HTML; motion lives in
// public/site/waitlist/waitlist.{css,js} (no libraries). Copy rules: Title Case UI, Cardbits only (no
// retail values), "Launching Soon" with no date, Latch & Friends throughout (Trevor, Nov 25 2026).
import { createHash } from "node:crypto";
import { assetUrl, pulseTag, shareMeta, SITE_SECURITY_HEADERS } from "../shell.server";
import { robotsTags } from "../seo.server";
import { FOUNDING, FOUNDING_TOTAL } from "./waitlist.server";
import cssSource from "../../../public/site/waitlist/waitlist.css?raw";
import jsSource from "../../../public/site/waitlist/waitlist.js?raw";

const v = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 10);
const CSS_V = v(cssSource);
const JS_V = v(jsSource);
const n = (x: number) => x.toLocaleString("en-US");

const PACKS = [
  { id: "mystery", name: "Mystery", cards: "1 Card", tags: ["Modern", "English"], line: "One Modern English Card per Rip." },
  { id: "booster", name: "Booster", cards: "5 Cards", tags: ["Modern", "English", "Japanese"], line: "Five Cards per Rip, Just Like a Real Booster." },
  { id: "gold", name: "Gold", cards: "1 Card", tags: ["Modern", "Vintage", "English", "Japanese"], line: "The Premium Pull With the Biggest Chases." },
  { id: "japanese", name: "Japanese", cards: "1 Card", tags: ["Modern", "Japanese"], line: "Modern Japanese Cards and Their Stunning Art." },
  { id: "wildcard", name: "Wildcard", cards: "1 Card", tags: ["Modern", "Vintage", "English", "Japanese"], line: "Anything Can Happen. That's the Point." },
];

// Card scans live in public/site/waitlist/cards/ (480px WebP, official scans). Trevor, Nov 25: only high-end hits
// (special illustration/art rares, alt arts, vintage holos; never regular ex or commons), lots of variety, and no
// card or Pokemon shown twice anywhere on the page. Every pull fits the rules of the pack it is shown with:
// Mystery = modern English; Booster = modern English/Japanese; Japanese = modern Japanese;
// Gold and Wildcard = modern + vintage, English/Japanese.
const cardUrl = (slug: string) => `/site/waitlist/cards/${slug}.webp?v=1`;
// Hero rip: three pulls per pack, in PACKS order.
const RIPS: Record<string, string[]> = {
  mystery: ["charizard-ex-sir-obf", "umbreon-ex-sir-pre", "pikachu-ex-sir-ssp"],
  booster: ["mew-ex-sar-sv2a", "rayquaza-vmax-alt-evs", "sylveon-ex-sir-pre"],
  gold: ["lugia-holo-neo-genesis", "giratina-v-alt-lor", "blastoise-holo-base"],
  japanese: ["eevee-ex-sar-sv8a", "iono-sar-sv4a", "snorlax-ar-sv2a"],
  wildcard: ["gengar-holo-fossil", "zapdos-ex-sar-sv2a", "greninja-ex-sir-twm"],
};
const HOW_FLIP = "espeon-ex-sir-pre";
const HOW_CHOOSE = "gardevoir-ex-sir-svi";
const VAULT = ["mewtwo-holo-base", "leafeon-vmax-alt-evs", "latias-ex-sir-ssp", "charmander-ir-151", "venusaur-holo-base", "psyduck-ar-sv2a", "dragapult-ex-sir-pre", "typhlosion-holo-neo-genesis", "glaceon-vmax-alt-evs"];
const FINAL = ["roaring-moon-ex-sir-par", "shining-gyarados-neo-revelation", "erikas-invitation-sar-sv2a", "blaziken-vmax-alt-cre", "ho-oh-holo-neo-revelation"];
const REEL_CARDS = ["terapagos-ex-sir-scr", "squirtle-ir-151", "bulbasaur-ir-151", "alakazam-holo-base", "magikarp-ir-pal", "raichu-ir-pal", "lillies-clefairy-ex-sir-jtg", "slowking-holo-1st-neo-revelation"];
// Daily Spin strip: each card tile appears once (REEL_CARDS index), the rest are Sparks and XP.
const REEL: [string, number][] = [["sparks", 25], ["card", 0], ["xp", 25], ["sparks", 50], ["xp", 10], ["card", 1], ["sparks", 10], ["xp", 50], ["sparks", 25], ["card", 2], ["xp", 25], ["sparks", 100], ["xp", 10], ["card", 3], ["sparks", 25], ["xp", 50], ["sparks", 50], ["card", 4], ["xp", 25], ["sparks", 10], ["xp", 10], ["card", 5], ["sparks", 25], ["xp", 50], ["sparks", 50], ["card", 6], ["xp", 25], ["sparks", 10], ["xp", 10], ["card", 7], ["sparks", 25], ["xp", 50]];
const BACK: Record<string, string> = { japanese: "cardbit-card-back-ja-modern.webp" };

const FRIENDS = [
  ["latch", "Latch", "webp"], ["blazebit", "Blazebit", "svg"], ["driplink", "Driplink", "svg"], ["mossbit", "Mossbit", "svg"],
  ["zappix", "Zappix", "svg"], ["cryobyte", "Cryobyte", "svg"], ["glitchog", "Glitchog", "svg"], ["phantab", "Phantab", "svg"],
  ["nimbyte", "Nimbyte", "svg"], ["wyrmware", "Wyrmware", "svg"],
] as const;
const friend = (id: string) => {
  const f = FRIENDS.find((x) => x[0] === id)!;
  return assetUrl(`cardbit-icon-${f[0]}.${f[2]}`);
};

const pack = (id: string) => assetUrl(`cardbit-latch-pack-${id}.webp`);

// Community callout under the hero signup (Trevor, Nov 25): Instagram, Facebook, Discord. Icons match the site footer.
export const SOCIALS = [
  { id: "instagram", name: "Instagram", href: "https://www.instagram.com/cardbitshop", label: "Follow Cardbit on Instagram",
    icon: '<svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6" fill="currentColor"/></svg>' },
  { id: "facebook", name: "Facebook", href: "https://www.facebook.com/cardbitshop", label: "Follow Cardbit on Facebook",
    icon: '<svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12Z"/></svg>' },
  { id: "discord", name: "Discord", href: "https://discord.gg/F9Z6jbgj4Y", label: "Join the Cardbit Discord",
    icon: '<svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18.2 18.2 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.7 19.7 0 0 0 6 3l1.3-2.1a12.8 12.8 0 0 1-2-1l.5-.4a14 14 0 0 0 12.2 0l.5.4a12.8 12.8 0 0 1-2 1l1.3 2.1a19.6 19.6 0 0 0 6-3c.5-5.2-.9-9.7-3.6-13.7ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>' },
];
const socials = () => `<div class="wl-social" data-wl-rise>
          <p class="wl-social__title">Join the Community</p>
          <p class="wl-social__text">Follow along for sneak peeks, pulls and launch news.</p>
          <div class="wl-social__row">${SOCIALS.map((x) => `<a class="wl-social__btn wl-social__btn--${x.id}" href="${x.href}" target="_blank" rel="noopener" aria-label="${x.label} (opens in a new tab)">${x.icon}<span>${x.name}</span></a>`).join("")}</div>
        </div>`;

function form(id: string, compact = false) {
  return `<form class="wl-form${compact ? " wl-form--compact" : ""}" data-wl-form novalidate>
    <div class="wl-field">
      <label for="${id}-email">Email</label>
      <input id="${id}-email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" required maxlength="254">
    </div>
    <div class="wl-field">
      <label for="${id}-phone">Mobile Number <span>Optional, +${n(FOUNDING.sms)} Cardbits</span></label>
      <input id="${id}-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="(555) 555-5555" maxlength="20">
    </div>
    <label class="wl-check">
      <input type="checkbox" name="emailConsent" required>
      <span>I'm 18 or Older and Agree to Get Cardbit Emails, Including Launch News and Offers. Unsubscribe Anytime. <a href="/policies#privacy-policy" target="_blank" rel="noopener">Privacy Policy</a>.</span>
    </label>
    <label class="wl-check wl-check--sms" data-wl-sms>
      <input type="checkbox" name="smsConsent">
      <span>I Agree to Recurring Automated Marketing Texts from Cardbit at This Number. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of purchase. US numbers only. See our <a href="/policies#sms-terms" target="_blank" rel="noopener">Text Message Terms</a> and <a href="/policies#privacy-policy" target="_blank" rel="noopener">Privacy Policy</a>.</span>
    </label>
    <div class="wl-hp" aria-hidden="true"><label>Company <input name="company" tabindex="-1" autocomplete="off"></label></div>
    <button class="wl-btn wl-btn--primary" type="submit"><span>Claim My Founding Spot</span></button>
    <p class="wl-error" role="alert" data-wl-error hidden></p>
  </form>
  <div class="wl-success" data-wl-success hidden tabindex="-1">
    <img class="wl-success__latch" src="/site/waitlist/latch-cheer.webp?v=1" alt="" width="180" height="191">
    <div class="wl-badge-medal" aria-hidden="true"><span>Founding<br>Collector</span></div>
    <h3 data-wl-success-title>You're In, Founding Collector</h3>
    <p data-wl-success-text>Watch your inbox. When Cardbit launches, sign up with this email and make your first top-up to unlock <b>${n(FOUNDING_TOTAL)} Cardbits</b>.</p>
    <div class="wl-share">
      <button class="wl-btn wl-btn--ghost" type="button" data-wl-share>Share Cardbit</button>
      <a class="wl-btn wl-btn--ghost" href="https://discord.gg/F9Z6jbgj4Y" target="_blank" rel="noopener">Join Our Discord</a>
    </div>
  </div>`;
}

const tags = (t: string[]) => t.map((x) => `<span>${x}</span>`).join("");

export function waitlistPage(env: NodeJS.ProcessEnv = process.env): string {
  const share = {
    title: "cardbit · Launching Soon. Rip Real Pokémon Packs Online.",
    description: `Open real Pokémon card packs online, keep every pull in your Vault, ship it home or sell it back for Cardbits. Join the waitlist: Founding Collectors get ${n(FOUNDING_TOTAL)} Cardbits.`,
    image: "cardbit-share.png",
    path: "/",
  };
  const steps = [
    { k: "pick", f: "zappix", t: "Pick a Pack", d: "Choose from five packs of real Pokémon cards. Every pack shows live odds from the cards still waiting in it." },
    { k: "rip", f: "blazebit", t: "Rip It Open", d: "Tear the wrapper and watch your card flip. The result is locked the moment you buy, so the reveal is all thrill, no tricks." },
    { k: "vault", f: "cryobyte", t: "It Lands in My Vault", d: "Every pull is a real card we hold for you, stored securely and insured. Your Vault tracks your whole collection." },
    { k: "choose", f: "driplink", t: "Keep, Ship or Sell Back", d: "Keep it, add it to a Ship Together box and get your cards delivered, or sell it back to us instantly for Cardbits." },
  ];
  return `<!doctype html>
<html lang="en" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#0b1114">
  ${robotsTags("/", env)}
  <meta name="referrer" content="same-origin">
  <title>cardbit · Launching Soon</title>
  ${shareMeta(share, env)}
  <link rel="icon" type="image/png" href="${assetUrl("cardbit-brand-emblem.png")}">
  <link rel="preload" as="font" type="font/woff2" href="${assetUrl("cardbit-outfit-800-latin.woff2")}" crossorigin>
  <link rel="preload" as="image" href="${pack("mystery")}">
  <style>
    @font-face{font-family:'Cardbit Outfit';src:url('${assetUrl("cardbit-outfit-800-latin.woff2")}') format('woff2');font-weight:800;font-display:swap}
    @font-face{font-family:'Cardbit Atkinson';src:url('${assetUrl("cardbit-type-atkinson.woff")}') format('woff');font-weight:200 800;font-display:swap}
  </style>
  <link rel="stylesheet" href="/site/waitlist/waitlist.css?v=${CSS_V}">
  <script>window.CardbitWaitlist = ${JSON.stringify({ packs: PACKS.map((p) => pack(p.id)), rips: PACKS.map((p) => RIPS[p.id].map(cardUrl)), backs: PACKS.map((p) => assetUrl(BACK[p.id] || "cardbit-card-back-en.webp")) }).replace(/</g, "\\u003c")};</script>
  <script src="/site/waitlist/waitlist.js?v=${JS_V}" defer></script>
  ${pulseTag()}
</head>
<body class="wl">
  <a class="wl-skip" href="#join">Skip to the Waitlist</a>
  <canvas class="wl-sparks" data-wl-sparks aria-hidden="true"></canvas>
  <header class="wl-top" data-wl-top>
    <a href="/" class="wl-logo" aria-label="cardbit home"><img src="${assetUrl("cardbit-brand-lockup.webp")}" alt="cardbit" width="150" height="30"></a>
    <span class="wl-pill"><i></i>Launching Soon</span>
    <a class="wl-btn wl-btn--small" href="#join" data-wl-jump>Join the Waitlist</a>
  </header>

  <main>
    <section class="wl-hero" aria-labelledby="wl-h1">
      <div class="wl-aurora" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="wl-hero__copy">
        <p class="wl-eyebrow" data-wl-rise>Founding Collectors Wanted</p>
        <h1 id="wl-h1" class="wl-h1" data-wl-split>Rip Real Pokémon Packs Online.</h1>
        <p class="wl-lede" data-wl-rise>Open a pack in seconds, see your pull instantly, and own the real card. Keep it in your Vault, ship it to your door, or sell it back for Cardbits.</p>
        <div class="wl-offer" data-wl-rise>
          <div class="wl-offer__coin" aria-hidden="true"><img src="${assetUrl("cardbit-bits-card-emblem.png")}" alt="" width="60" height="70"></div>
          <div>
            <b><span data-wl-count="${FOUNDING_TOTAL}">${n(FOUNDING_TOTAL)}</span> Free Cardbits + Founding Collector Badge</b>
            <small>${n(FOUNDING.email)} for your email, ${n(FOUNDING.sms)} for your phone. Unlocks with your first top-up after launch.</small>
          </div>
        </div>
        <div class="wl-card wl-join" id="join" data-wl-rise>
          <h2 class="wl-join__title">Join the Waitlist</h2>
          ${form("hero")}
        </div>
        ${socials()}
      </div>

      <div class="wl-stage" data-wl-stage aria-hidden="true">
        <div class="wl-stage__glow"></div>
        <div class="wl-stage__ring"></div>
        <img class="wl-side wl-side--l" src="${pack("gold")}" alt="" width="842" height="1520">
        <img class="wl-side wl-side--r" src="${pack("japanese")}" alt="" width="842" height="1520">
        <div class="wl-rip" data-wl-rip>
          <div class="wl-rip__cards">
            ${[0, 1, 2].map((i) => `<div class="wl-rip__card" style="--i:${i}"><div class="wl-flip"><img class="wl-flip__back" data-wl-back src="${assetUrl("cardbit-card-back-en.webp")}" alt=""><img class="wl-flip__front" data-wl-front src="${cardUrl(RIPS.mystery[i])}" alt=""></div></div>`).join("")}
          </div>
          <div class="wl-rip__pack" data-wl-pack>
            <div class="wl-rip__body" style="--art:url('${pack("mystery")}')"></div>
            <div class="wl-rip__top" style="--art:url('${pack("mystery")}')"></div>
            <div class="wl-rip__shine" style="--art-mask:url('${pack("mystery")}')"></div>
          </div>
          <div class="wl-rip__burst"></div>
        </div>
        <img class="wl-stage__latch" src="/site/waitlist/latch-full.webp?v=2" alt="" width="713" height="790">
      </div>
      <a class="wl-scrollcue" href="#how" aria-label="See How Cardbit Works"><span></span></a>
    </section>

    <div class="wl-marquee" aria-hidden="true"><div class="wl-marquee__track">
      ${Array(2).fill(["Real Cards", "Instant Reveals", "My Vault", "Ship Together", "Sell Back for Cardbits", "Verified Shuffle", "Daily Spins", "Levels & Sparks"].map((t) => `<span>${t}</span><i>✦</i>`).join("")).join("")}
    </div></div>

    <section class="wl-how" id="how" aria-labelledby="wl-how-h" data-wl-how>
      <div class="wl-how__pin">
        <div class="wl-how__copy">
          <p class="wl-eyebrow">How Cardbit Works</p>
          <h2 id="wl-how-h" class="wl-h2">From Rip to Real in Four Steps</h2>
          <ol class="wl-steps">
            ${steps.map((s, i) => `<li class="wl-step" data-wl-step="${i}"><img src="${friend(s.f)}" alt="" width="56" height="56"><div><b><em>${i + 1}</em>${s.t}</b><p>${s.d}</p></div></li>`).join("")}
          </ol>
          <div class="wl-rail" aria-hidden="true"><i data-wl-rail></i></div>
        </div>
        <div class="wl-how__stage" aria-hidden="true" data-wl-how-stage data-scene="0">
          <div class="wl-scene wl-scene--pick">
            ${PACKS.map((p, i) => `<img src="${pack(p.id)}" alt="" style="--i:${i};--ai:${Math.abs(i - 2)}">`).join("")}
          </div>
          <div class="wl-scene wl-scene--rip">
            <div class="wl-bigflip"><div class="wl-flip"><img class="wl-flip__back" src="${assetUrl("cardbit-card-back-en.webp")}" alt=""><img class="wl-flip__front" src="${cardUrl(HOW_FLIP)}" alt=""></div></div>
            <span class="wl-tierchip">Pulled!</span>
          </div>
          <div class="wl-scene wl-scene--vault">
            <div class="wl-vault">${VAULT.map((c, i) => `<img src="${cardUrl(c)}" alt="" style="--i:${i}" loading="lazy">`).join("")}</div>
            <div class="wl-vault__label"><b>My Vault</b><span>Real Cards, Held for You</span></div>
          </div>
          <div class="wl-scene wl-scene--choose">
            <div class="wl-choose__card"><img src="${cardUrl(HOW_CHOOSE)}" alt=""></div>
            <div class="wl-choice wl-choice--keep"><b>Keep</b><span>Stays in My Vault</span></div>
            <div class="wl-choice wl-choice--ship"><b>Ship Together</b><span>Bundle Cards in One Box</span></div>
            <div class="wl-choice wl-choice--sell"><b>Sell Back</b><span>Instant Cardbits</span></div>
          </div>
        </div>
      </div>
    </section>

    <section class="wl-packs" aria-labelledby="wl-packs-h">
      <p class="wl-eyebrow" data-wl-reveal>The Lineup</p>
      <h2 id="wl-packs-h" class="wl-h2" data-wl-reveal>Five Packs. Every Card Real.</h2>
      <div class="wl-carousel" data-wl-carousel tabindex="0" role="group" aria-roledescription="carousel" aria-label="Cardbit packs. Use the arrow keys to browse.">
        ${PACKS.map((p, i) => `<figure class="wl-packcard" data-i="${i}" role="group" aria-roledescription="slide" aria-label="${p.name} Pack, ${i + 1} of ${PACKS.length}">
          <div class="wl-packcard__art"><img src="${pack(p.id)}" alt="${p.name} Edition pack" width="842" height="1520" loading="lazy"><i style="--m:url('${pack(p.id)}')"></i></div>
          <figcaption><b>${p.name} Edition</b><span class="wl-count">${p.cards}</span><p>${p.line}</p><div class="wl-tags">${tags(p.tags)}</div></figcaption>
        </figure>`).join("")}
      </div>
      <div class="wl-carousel__nav">
        <button class="wl-round" type="button" data-wl-prev aria-label="Previous Pack">‹</button>
        <div class="wl-dots" data-wl-dots>${PACKS.map((p, i) => `<button type="button" aria-label="Show ${p.name} Edition" data-i="${i}"></button>`).join("")}</div>
        <button class="wl-round" type="button" data-wl-next aria-label="Next Pack">›</button>
      </div>
    </section>

    <section class="wl-play" aria-labelledby="wl-play-h">
      <p class="wl-eyebrow" data-wl-reveal>More Than Packs</p>
      <h2 id="wl-play-h" class="wl-h2" data-wl-reveal>Come Back Every Day</h2>
      <div class="wl-grid3">
        <article class="wl-card wl-feature" data-wl-reveal>
          <div class="wl-reel" aria-hidden="true" data-wl-reel><span class="wl-reel__mk wl-reel__mk--t"></span><div class="wl-reel__track" data-wl-reel-track>${REEL.map(([k, x]) =>
            k === "card" ? `<div class="wl-tile is-card" data-k="card"><img src="${cardUrl(REEL_CARDS[x])}" alt="" loading="lazy"></div>`
            : k === "sparks" ? `<div class="wl-tile is-sparks" data-k="sparks"><img src="${assetUrl("cardbit-sparks.svg")}" alt=""><b>${x}</b><span>Sparks</span></div>`
            : `<div class="wl-tile is-xp" data-k="xp"><i>XP</i><b>+${x}</b><span>XP</span></div>`).join("")}</div><span class="wl-reel__mk wl-reel__mk--b"></span></div>
          <h3>Daily Spins</h3><p>A free spin every day for Sparks, XP or a real card. Level up to unlock better spins with bigger prizes.</p>
        </article>
        <article class="wl-card wl-feature" data-wl-reveal>
          <div class="wl-level" aria-hidden="true"><img src="${friend("nimbyte")}" alt=""><div><b>Level <span data-wl-level>7</span></b><div class="wl-xp"><i data-wl-xp></i></div><small>XP From Every Pack You Open</small></div></div>
          <h3>Levels & XP</h3><p>Earn XP as you open packs and check in. Higher levels unlock new Latch & Friends icons and better daily rewards.</p>
        </article>
        <article class="wl-card wl-feature" data-wl-reveal>
          <div class="wl-sparkbox" aria-hidden="true"><img src="${assetUrl("cardbit-sparks.svg")}" alt=""><span></span><span></span><span></span><span></span></div>
          <h3>Sparks</h3><p>Earn Sparks as you play and trade them in the Spark Shop for real cards.</p>
        </article>
      </div>
    </section>

    <section class="wl-trust" aria-labelledby="wl-trust-h">
      <div class="wl-trust__shuffle" aria-hidden="true" data-wl-shuffle>
        ${[0, 1, 2, 3, 4].map((i) => `<img src="${assetUrl("cardbit-card-back-en.webp")}" alt="" style="--i:${i}">`).join("")}
        <div class="wl-lock"><svg viewBox="0 0 24 24"><path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" stroke-width="2"/><rect x="5" y="10" width="14" height="11" rx="2.5" fill="currentColor"/></svg><code data-wl-hash>9f3a·c41e·77b0·2d58</code></div>
      </div>
      <div class="wl-trust__copy">
        <p class="wl-eyebrow" data-wl-reveal>Fair, Real, Yours</p>
        <h2 id="wl-trust-h" class="wl-h2" data-wl-reveal>Verified Shuffle, Real Cards</h2>
        <p data-wl-reveal>Every opening is drawn from a shuffle that's locked before you buy. You see its fingerprint first, and you can check the draw yourself afterward on the Verified Shuffle page.</p>
        <ul class="wl-ticks" data-wl-reveal>
          <li>Every Card Guaranteed Authentic</li>
          <li>Stored Securely and Insured</li>
          <li>Live Odds From the Cards Still in Each Pack</li>
          <li>Hosted by Poke-Collect</li>
        </ul>
      </div>
    </section>

    <section class="wl-friends" aria-labelledby="wl-friends-h">
      <p class="wl-eyebrow" data-wl-reveal>Say Hi</p>
      <h2 id="wl-friends-h" class="wl-h2" data-wl-reveal>Meet Latch & Friends</h2>
      <p class="wl-sub" data-wl-reveal>Latch is the Cardbit mascot. Collect his digital friends as profile icons as you level up.</p>
      <ul class="wl-friendrow">
        ${FRIENDS.map(([id, name], i) => `<li style="--i:${i}" data-wl-reveal><img src="${friend(id)}" alt="" width="96" height="96" loading="lazy"><span>${name}</span></li>`).join("")}
      </ul>
    </section>

    <section class="wl-final" aria-labelledby="wl-final-h">
      <div class="wl-final__cards" aria-hidden="true">${FINAL.map((c, i) => `<img src="${cardUrl(c)}" alt="" style="--i:${i}" loading="lazy">`).join("")}</div>
      <div class="wl-card wl-final__box" data-wl-reveal>
        <p class="wl-eyebrow">Launching Soon</p>
        <h2 id="wl-final-h" class="wl-h2">Become a Founding Collector</h2>
        <ul class="wl-perks">
          <li><b>${n(FOUNDING_TOTAL)} Cardbits</b><span>Unlocks with your first top-up</span></li>
          <li><b>Founding Badge</b><span>Shown on your profile forever</span></li>
          <li><b>First In Line</b><span>Hear the moment we open</span></li>
        </ul>
        ${form("final", true)}
      </div>
    </section>

    <section class="wl-faq" aria-labelledby="wl-faq-h">
      <h2 id="wl-faq-h" class="wl-h2" data-wl-reveal>Questions</h2>
      <details data-wl-reveal><summary>When Does Cardbit Launch?</summary><p>Very soon. Everyone on the waitlist hears first, by email (and text if you add your number).</p></details>
      <details data-wl-reveal><summary>How Do I Get the ${n(FOUNDING_TOTAL)} Cardbits?</summary><p>Join with your email (${n(FOUNDING.email)} Cardbits) and add a mobile number for text alerts (${n(FOUNDING.sms)} more). After launch, create your Cardbit account with the same email and make your first top-up of any amount. The bonus is added then. The text-alert part is added once your number is confirmed. One bonus per person, email and phone number. It replaces the regular signup rewards and has no cash value.</p></details>
      <details data-wl-reveal><summary>Are the Cards Real?</summary><p>Yes. Every card you pull is a real, authentic Pokémon card that we hold for you in secure, insured storage until you ship it or sell it back.</p></details>
      <details data-wl-reveal><summary>What Are Cardbits?</summary><p>Cardbits are Cardbit's store credit. 100 Cardbits equal $1.00 to spend on packs, singles and shipping. Selling a card back adds Cardbits to your balance instantly.</p></details>
      <details data-wl-reveal><summary>Where Is Cardbit Available?</summary><p>Anyone can join the waitlist. Purchases and shipping are for US addresses outside AL, HI, ID, MN, NV, NY, UT and WA, for people 18 and older.</p></details>
    </section>
  </main>

  <footer class="wl-foot">
    <img src="${assetUrl("cardbit-brand-lockup.webp")}" alt="cardbit" width="130" height="26" loading="lazy">
    <p>Hosted by Poke-Collect.</p>
    <nav aria-label="Footer">
      <a href="/policies">Policies</a><a href="/official-rules">Official Rules</a><a href="mailto:Support@cardbit.com">Support@cardbit.com</a>
    </nav>
    <nav class="wl-social" aria-label="Social">
      <a href="https://www.instagram.com/cardbitshop" target="_blank" rel="noopener">Instagram</a>
      <a href="https://www.facebook.com/cardbitshop" target="_blank" rel="noopener">Facebook</a>
      <a href="https://discord.gg/F9Z6jbgj4Y" target="_blank" rel="noopener">Discord</a>
    </nav>
    <small>Pokémon is a trademark of its respective owners. Cardbit is not affiliated with or endorsed by The Pokémon Company.</small>
  </footer>
  <div class="wl-toast" role="status" aria-live="polite" data-wl-toast></div>
</body>
</html>`;
}

export function waitlistResponse(): Response {
  return new Response(waitlistPage(), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...SITE_SECURITY_HEADERS },
  });
}
