// Link-preview banners (Open Graph / X cards) for cardbit.com: 1200x630 PNGs in public/site/share/.
// Run after changing brand or pack art:  node scripts/site/share-banners.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // pre-installed globally; not a repo dependency
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');
const assets = join(repo, 'public/site/assets');
const out = join(repo, 'public/site/share');
mkdirSync(out, { recursive: true });
const data = (f) => `data:${f.endsWith('.woff2') ? 'font/woff2' : f.endsWith('.png') ? 'image/png' : 'image/webp'};base64,${readFileSync(join(assets, f)).toString('base64')}`;

export const PACKS = [
  { id: 'cobalt', name: 'Mystery', art: 'cardbit-mystery-edition.webp', glow: '#8a5cff', line: 'One Pokémon Card per Pack' },
  { id: 'prism', name: 'Booster', art: 'cardbit-booster-edition.webp', glow: '#2f7bff', line: 'Five Pokémon Cards per Pack' },
  { id: 'gold', name: 'Gold', art: 'cardbit-gold-edition.webp', glow: '#e3b341', line: 'One Pokémon Card per Pack' },
  { id: 'ember', name: 'Japanese', art: 'cardbit-japanese-edition.webp', glow: '#ff4a4a', line: 'One Japanese Pokémon Card per Pack' },
  { id: 'amethyst', name: 'Wildcard', art: 'cardbit-wildcard-edition.webp', glow: '#b45cff', line: 'One Pokémon Card per Pack' },
];

const css = `
@font-face{font-family:Outfit;src:url(${data('cardbit-outfit-800-latin.woff2')}) format('woff2');font-weight:800}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;background:#0b1214;font-family:Outfit,system-ui,sans-serif;color:#f6faf9}
.wrap{position:relative;width:1200px;height:630px;background:radial-gradient(900px 600px at 82% 55%,var(--glow,#00e6e1)33,transparent 60%),radial-gradient(700px 500px at 0% 0%,#0f3a3d,transparent 70%),linear-gradient(135deg,#0d181b,#101828 60%,#0b1013)}
.grid{position:absolute;inset:0;background-image:linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(90deg,#000 0%,transparent 70%)}
.copy{position:absolute;left:72px;top:0;bottom:0;width:560px;display:flex;flex-direction:column;justify-content:center;gap:26px}
.lockup{width:300px}
h1{font-size:68px;line-height:1.02;letter-spacing:-.01em}
h1 span{color:#2cefed}
p{font-size:28px;line-height:1.25;color:#c9d7d8}
.url{display:inline-flex;align-self:flex-start;align-items:center;gap:10px;padding:12px 20px;border-radius:999px;background:#00e6e1;color:#082022;font-size:24px}
.stage{position:absolute;right:0;top:0;width:620px;height:630px}
.pack{position:absolute;width:200px;filter:drop-shadow(0 24px 30px #000a)}
.hero{position:absolute;width:300px;right:150px;top:46px;filter:drop-shadow(0 30px 40px #000c) drop-shadow(0 0 60px var(--glow))}
.latch{position:absolute;width:200px;right:40px;bottom:-6px;filter:drop-shadow(0 18px 24px #000b)}
`;

const fan = () => {
  const spots = [[-14, 30, 120], [-7, 120, 80], [0, 215, 60], [7, 310, 80], [14, 400, 120]];
  return PACKS.map((p, i) => `<img class="pack" src="${data(p.art)}" style="left:${spots[i][1]}px;top:${spots[i][2]}px;transform:rotate(${spots[i][0]}deg);z-index:${i === 2 ? 5 : 5 - Math.abs(2 - i)}">`).join('');
};

const page = ({ glow, title, sub, stage }) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div class="wrap" style="--glow:${glow}"><div class="grid"></div>
<div class="copy"><img class="lockup" src="${data('cardbit-brand-lockup.webp')}" alt=""><h1>${title}</h1><p>${sub}</p><span class="url">cardbit.com</span></div>
<div class="stage">${stage}</div></div></body></html>`;

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
async function shot(name, html) {
  await tab.setContent(html, { waitUntil: 'load' });
  await tab.evaluate(() => document.fonts.ready);
  await tab.screenshot({ path: join(out, name), type: 'png' });
  console.log('wrote', name);
}
await shot('cardbit-share.png', page({ glow: '#00e6e1', title: 'Digital Packs.<br><span>Real Pokémon Cards.</span>', sub: 'Open Packs Online. Every Pull Is a Real Card You Can Vault, Ship or Sell Back.', stage: fan() }));
for (const p of PACKS)
  await shot(`cardbit-share-${p.id}.png`, page({ glow: p.glow, title: `${p.name}<br><span>Edition Pack</span>`, sub: `${p.line}. Open It Online, Then Vault, Ship or Sell Back Your Pull.`, stage: `<img class="hero" src="${data(p.art)}" alt=""><img class="latch" src="${data('cardbit-latch-cheer.webp')}" alt="">` }));
await browser.close();
