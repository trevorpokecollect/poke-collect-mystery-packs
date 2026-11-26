// cardbit.com/links: the Instagram bio link page (Trevor, Nov 25 2026). The new @cardbitshop account can't add
// bio links, so this one page holds them all. Never gated by coming-soon mode; ad pixels stay consent-gated
// through pulseTag(). Styling reuses the waitlist sheet (tokens, buttons, brand colors).
import { createHash } from "node:crypto";
import { assetUrl, pulseTag, shareMeta, SITE_SECURITY_HEADERS } from "../shell.server";
import { robotsTags } from "../seo.server";
import { FOUNDING_TOTAL } from "./waitlist.server";
import { SOCIALS } from "./page.server";
import cssSource from "../../../public/site/waitlist/waitlist.css?raw";

const CSS_V = createHash("sha256").update(cssSource).digest("hex").slice(0, 10);
const n = (x: number) => x.toLocaleString("en-US");

const STYLE = `
.lk { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; align-items: center; padding: 28px 16px 0; position: relative; overflow: hidden; }
.lk main { width: 100%; max-width: 440px; display: flex; flex-direction: column; align-items: center; text-align: center; flex: 1; }
.lk-logo img { width: 150px; height: auto; margin: 0 auto 14px; }
.lk-latch { width: 150px; height: auto; margin: 4px auto 6px; filter: drop-shadow(0 18px 30px rgba(0, 230, 225, .28)); animation: lk-bob 3.6s ease-in-out infinite; }
@keyframes lk-bob { 50% { transform: translateY(-6px) rotate(-2deg); } }
.lk h1 { margin: 6px 0 6px; font: 800 30px/1.05 var(--display); letter-spacing: -.015em; text-wrap: balance; }
.lk-lede { margin: 0 0 22px; color: var(--muted); font-size: 16px; }
.lk-lede b { color: var(--apricot); }
.lk-list { width: 100%; display: grid; gap: 12px; margin: 0 0 26px; padding: 0; list-style: none; }
.lk-list a { width: 100%; min-height: 58px; font-size: 17px; border-radius: 16px; }
.lk-list .wl-social__btn { justify-content: center; }
.lk-list .wl-social__btn svg { width: 22px; height: 22px; flex: none; }
.lk-list .wl-btn--primary { flex-direction: column; gap: 0; line-height: 1.15; min-height: 66px; }
.lk-list .wl-btn--primary small { font: 700 13px var(--body); opacity: .8; }
.lk .wl-foot { width: 100%; padding: 26px 16px 34px; margin-top: auto; }
@media (prefers-reduced-motion: reduce) { .lk-latch { animation: none; } }
`;

export function linksPage(env: NodeJS.ProcessEnv = process.env): string {
  const share = {
    title: "cardbit · Links",
    description: `Rip real Pokémon packs online. Join the Cardbit waitlist (Founding Collectors get ${n(FOUNDING_TOTAL)} Cardbits), our Discord, Instagram and Facebook.`,
    image: "cardbit-share.png",
    path: "/links",
  };
  const socials = ["discord", "instagram", "facebook"]
    .map((id) => SOCIALS.find((s) => s.id === id)!)
    .map((x) => `<li><a class="wl-social__btn wl-social__btn--${x.id}" href="${x.href}" target="_blank" rel="noopener" aria-label="${x.label} (opens in a new tab)">${x.icon}<span>${x.id === "discord" ? "Join Our Discord" : `Follow on ${x.name}`}</span></a></li>`)
    .join("\n        ");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#0b1114">
  ${robotsTags("/links", env)}
  <meta name="referrer" content="same-origin">
  <title>cardbit · Links</title>
  ${shareMeta(share, env)}
  <link rel="icon" type="image/png" href="${assetUrl("cardbit-brand-emblem.png")}">
  <link rel="preload" as="font" type="font/woff2" href="${assetUrl("cardbit-outfit-800-latin.woff2")}" crossorigin>
  <style>
    @font-face{font-family:'Cardbit Outfit';src:url('${assetUrl("cardbit-outfit-800-latin.woff2")}') format('woff2');font-weight:800;font-display:swap}
    @font-face{font-family:'Cardbit Atkinson';src:url('${assetUrl("cardbit-type-atkinson.woff")}') format('woff');font-weight:200 800;font-display:swap}
  </style>
  <link rel="stylesheet" href="/site/waitlist/waitlist.css?v=${CSS_V}">
  <style>${STYLE}</style>
  ${pulseTag()}
</head>
<body class="wl lk">
  <div class="wl-aurora" aria-hidden="true"><i></i><i></i><i></i></div>
  <main>
    <a href="/" class="lk-logo" aria-label="cardbit home"><img src="${assetUrl("cardbit-brand-lockup.webp")}" alt="cardbit" width="150" height="30"></a>
    <img class="lk-latch" src="/site/waitlist/latch-cheer.webp?v=1" alt="" width="150" height="159">
    <h1>Buy Real Pokémon Cards Online</h1>
    <p class="lk-lede">Founding Collectors get <b>${n(FOUNDING_TOTAL)} Cardbits</b> at launch.</p>
    <ul class="lk-list">
        <li><a class="wl-btn wl-btn--primary" href="/?utm_source=instagram&amp;utm_medium=bio&amp;utm_campaign=links#join"><span>Join the Waitlist</span><small>cardbit.com</small></a></li>
        ${socials}
    </ul>
  </main>
  <footer class="wl-foot">
    <nav aria-label="Footer">
      <a href="/policies">Policies</a><a href="/official-rules">Official Rules</a><a href="mailto:Support@cardbit.com">Support@cardbit.com</a>
    </nav>
    <small>Pokémon is a trademark of its respective owners. Cardbit is not affiliated with or endorsed by The Pokémon Company.</small>
  </footer>
</body>
</html>`;
}

export function linksResponse(): Response {
  return new Response(linksPage(), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...SITE_SECURITY_HEADERS },
  });
}
