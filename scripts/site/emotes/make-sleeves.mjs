// Builds the Pack Pass card sleeves (opening cosmetics MOCKUP, not wired yet).
//   node scripts/site/emotes/make-sleeves.mjs
// A sleeve covers the back of face-down cards in the member's own openings, like a matte sleeve on a real card.
// The card itself is still the real card: the sleeve never changes what is pulled.
// Writes public/site/img/pass/sleeves/<id>.svg at 600x837 (same ratio as cardbit-card-back-en.webp).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const OUT = "public/site/img/pass/sleeves";
const FONT = JSON.parse(readFileSync("scripts/site/emotes/art/outfit-800-glyphs.json", "utf8"));
const W = 600, H = 837, CX = 300, CY = 418;
const RM = `@media (prefers-reduced-motion:reduce){*{animation:none!important}}`;

function text(str, x, y, size, attrs, track = 0) {
  const s = size / FONT.upm;
  const widths = [...str].map((ch) => (ch === " " ? 280 : FONT.glyphs[ch].adv) * s + track);
  const total = widths.reduce((a, b) => a + b, 0) - track;
  let pen = x - total / 2;
  return [...str].map((ch, i) => {
    const g = ch === " " ? "" : `<path transform="translate(${pen.toFixed(2)},${y}) scale(${s.toFixed(4)})" d="${FONT.glyphs[ch].d}" ${attrs}/>`;
    pen += widths[i];
    return g;
  }).join("");
}

// The real Cardbit emblem and wordmark, traced from public/site/assets/cardbit-brand-lockup.webp
// into art/cardbit-emblem-paths.json (142x170 emblem, wordmark in its own box). Recolored per sleeve.
const LOGO = JSON.parse(readFileSync("scripts/site/emotes/art/cardbit-emblem-paths.json", "utf8"));
const STRIPES = [0, 1, 2].map((i) => { const x = 96 + i * 11.5; return `M${x + 3},142 H${x + 10} L${x + 7},148.5 H${x} Z`; }).join("");
function emblem(scale, { card, edge, b, bits, stripe, glow }) {
  const sc = scale * 1.5;
  return `<g transform="translate(${CX - 71 * sc},${CY - 85 * sc}) scale(${sc})"${glow ? ` filter="url(#${glow})"` : ""}>
<path d="${LOGO.outer}" fill="${edge}"/><path d="${LOGO.inner}" fill="${card}"/>
<path d="${LOGO.b}" fill="${b}"/><path d="${LOGO.bits}" fill="${bits}"/><path d="${STRIPES}" fill="${stripe}"/></g>`;
}

const frame = (inner, stroke, sw = 3) => `<rect x="34" y="34" width="${W - 68}" height="${H - 68}" rx="18" fill="none" stroke="${stroke}" stroke-width="${sw}"/>${inner || ""}`;
const sheen = (id, color = "#fff", op = 0.22) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${color}" stop-opacity="0"/><stop offset=".5" stop-color="${color}" stop-opacity="${op}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>`;
const sweep = (id) => `<g clip-path="url(#clip)"><rect class="sweep" x="-260" y="-200" width="220" height="${H + 400}" fill="url(#${id})" transform="rotate(18 ${CX} ${CY})"/></g>`;
const SWEEP_CSS = `.sweep{animation:sweep 3.6s ease-in-out infinite}@keyframes sweep{0%,30%{transform:translateX(0)}80%,100%{transform:translateX(1100px)}}`;
const head = (id, label, css, defs) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${label}">
<style>${SWEEP_CSS}${css}${RM}</style>
<defs><clipPath id="clip"><rect width="${W}" height="${H}" rx="30"/></clipPath>
<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>${defs}</defs>`;
// The italic "cardbit" wordmark at the top, and upside down at the bottom like a real card back.
function word(fill, y = 112, size = 44) {
  const wd = size * 4.3, sc = wd / LOGO.wordW, ht = LOGO.wordH * sc, top = y - ht * 0.8;
  const one = (t) => `<g transform="translate(${CX - wd / 2},${t}) scale(${sc.toFixed(4)})"><path d="${LOGO.word}" fill="${fill}"/></g>`;
  return one(top) + `<g transform="rotate(180 ${CX} ${H / 2})">${one(top)}</g>`;
}

// Seeded random so the art is the same on every run.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const SLEEVES = {
  neon: { name: "Neon", tier: "pro", svg() {
    const grid = [];
    for (let x = -W; x < W * 2; x += 46) grid.push(`<line x1="${x}" y1="0" x2="${x + H * 0.58}" y2="${H}"/><line x1="${x}" y1="0" x2="${x - H * 0.58}" y2="${H}"/>`);
    return head("neon", "Neon sleeve", `.pulse{animation:pulse 2.4s ease-in-out infinite}@keyframes pulse{0%,100%{opacity:.6}50%{opacity:1}}`,
      sheen("sh", "#7DF3EA", 0.28) + `<radialGradient id="bg" cx=".5" cy=".5" r=".7"><stop offset="0" stop-color="#0d3a40"/><stop offset="1" stop-color="#03100f"/></radialGradient>`) +
      `<g clip-path="url(#clip)"><rect width="${W}" height="${H}" fill="url(#bg)"/>
<g stroke="#2EE6F0" stroke-width="1.4" opacity=".16">${grid.join("")}</g>
<circle cx="${CX}" cy="${CY}" r="210" fill="none" stroke="#2EE6F0" stroke-width="2" opacity=".35" stroke-dasharray="4 10"/>
<circle class="pulse" cx="${CX}" cy="${CY}" r="170" fill="none" stroke="#2EE6F0" stroke-width="3" opacity=".5"/></g>
<g filter="url(#glow)">${frame("", "#2EE6F0", 4)}</g>${frame("", "#bffcff", 1.2)}
<g class="pulse">${emblem(1.05, { card: "#062327", edge: "#2EE6F0", b: "#e9feff", bits: "#2EE6F0", stripe: "#2EE6F0", glow: "glow" })}</g>
<g filter="url(#glow)" opacity=".9">${word("#2EE6F0")}</g>${sweep("sh")}
<rect width="${W}" height="${H}" rx="30" fill="none" stroke="#0a2a2e" stroke-width="10"/></svg>`;
  } },
  holo: { name: "Holo", tier: "pro", svg() {
    const dia = [];
    for (let y = 0; y < H + 60; y += 52) for (let x = (y / 52) % 2 ? 26 : 0; x < W + 52; x += 52) dia.push(`<polygon points="${x},${y - 22} ${x + 18},${y} ${x},${y + 22} ${x - 18},${y}"/>`);
    return head("holo", "Holo sleeve", `.hue{animation:hue 6s linear infinite}@keyframes hue{to{transform:translateX(-600px)}}`,
      sheen("sh", "#fff", 0.55) + `<linearGradient id="rb" x1="0" y1="0" x2="1" y2="1" spreadMethod="repeat"><stop offset="0" stop-color="#ff9bd8"/><stop offset=".2" stop-color="#ffd27a"/><stop offset=".4" stop-color="#9dffb0"/><stop offset=".6" stop-color="#7de0ff"/><stop offset=".8" stop-color="#b79bff"/><stop offset="1" stop-color="#ff9bd8"/></linearGradient>`) +
      `<g clip-path="url(#clip)"><g class="hue"><rect width="${W * 2}" height="${H}" fill="url(#rb)"/></g>
<rect width="${W}" height="${H}" fill="#1a1440" opacity=".35"/>
<g fill="#fff" opacity=".13">${dia.join("")}</g></g>
${frame("", "#ffffff", 4)}${frame(`<rect x="46" y="46" width="${W - 92}" height="${H - 92}" rx="12" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.2"/>`, "#ffffff", 4)}
${emblem(1.05, { card: "#ffffff", edge: "#2a1f6b", b: "#2a1f6b", bits: "#7a5cff", stripe: "#ff6fd8" })}
${word("#ffffff")}${sweep("sh")}<rect width="${W}" height="${H}" rx="30" fill="none" stroke="#e8e0ff" stroke-width="10"/></svg>`;
  } },
  midnight: { name: "Midnight", tier: "pro", svg() {
    seed = 11;
    const stars = Array.from({ length: 90 }, (_, i) => {
      const x = (rnd() * (W - 80) + 40).toFixed(1), y = (rnd() * (H - 80) + 40).toFixed(1), r = (0.6 + rnd() * 1.8).toFixed(2);
      return `<circle class="tw t${i % 3}" cx="${x}" cy="${y}" r="${r}" fill="#dfe8ff"/>`;
    }).join("");
    return head("midnight", "Midnight sleeve", `.tw{animation:tw 2.4s ease-in-out infinite}.t1{animation-delay:-.8s}.t2{animation-delay:-1.6s}@keyframes tw{0%,100%{opacity:.25}50%{opacity:1}}`,
      sheen("sh", "#cfd8ff", 0.18) + `<radialGradient id="bg" cx=".5" cy=".42" r=".75"><stop offset="0" stop-color="#1b2a66"/><stop offset=".6" stop-color="#0a1233"/><stop offset="1" stop-color="#03050f"/></radialGradient>
<linearGradient id="sv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f7ff"/><stop offset=".5" stop-color="#9aa6c8"/><stop offset="1" stop-color="#e6ebff"/></linearGradient>`) +
      `<g clip-path="url(#clip)"><rect width="${W}" height="${H}" fill="url(#bg)"/>${stars}
<circle cx="${CX + 150}" cy="${CY - 250}" r="46" fill="#e9eeff" opacity=".9"/><circle cx="${CX + 170}" cy="${CY - 262}" r="44" fill="#0f1a44"/></g>
${frame("", "url(#sv)", 3)}${frame(`<rect x="46" y="46" width="${W - 92}" height="${H - 92}" rx="12" fill="none" stroke="url(#sv)" stroke-width="1"/>`, "url(#sv)", 3)}
${emblem(1.05, { card: "#0b1438", edge: "url(#sv)", b: "#eef2ff", bits: "#9aa6c8", stripe: "#9aa6c8" })}
${word("url(#sv)")}${sweep("sh")}<rect width="${W}" height="${H}" rx="30" fill="none" stroke="#1a2350" stroke-width="10"/></svg>`;
  } },
  circuit: { name: "Pro Circuit", tier: "pro", svg() {
    // Traces run out from the emblem to the edges; light pulses travel along them. Pro's violet and pink.
    const traces = [];
    const dirs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    dirs.forEach(([sx, sy], q) => {
      for (let k = 0; k < 4; k++) {
        const y0 = CY + sy * (40 + k * 34), x1 = CX + sx * (130 + k * 18), y2 = CY + sy * (200 + k * 40), x3 = CX + sx * (250 - k * 6);
        const d = `M${CX + sx * 100},${y0} H${x1} L${x1 + sx * 40},${y0 + sy * 40} V${y2} H${x3}`;
        traces.push(`<path d="${d}" fill="none"/><path class="run r${(q + k) % 4}" d="${d}" pathLength="100"/><circle cx="${x3}" cy="${y2}" r="5"/>`);
      }
    });
    return head("circuit", "Pro Circuit sleeve", `.run{fill:none;stroke:#FF6FD8;stroke-width:4;stroke-dasharray:10 90;animation:run 2.4s linear infinite}.r1{animation-delay:-.6s}.r2{animation-delay:-1.2s}.r3{animation-delay:-1.8s}@keyframes run{from{stroke-dashoffset:100}to{stroke-dashoffset:0}}`,
      sheen("sh", "#e7d7ff", 0.24) + `<radialGradient id="bg" cx=".5" cy=".5" r=".75"><stop offset="0" stop-color="#3a1f7a"/><stop offset="1" stop-color="#0d0624"/></radialGradient>
<linearGradient id="pr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#B98CFF"/><stop offset="1" stop-color="#FF6FD8"/></linearGradient>`) +
      `<g clip-path="url(#clip)"><rect width="${W}" height="${H}" fill="url(#bg)"/>
<g stroke="#B98CFF" stroke-width="3" fill="#B98CFF" opacity=".75" stroke-linejoin="round">${traces.join("")}</g></g>
<g filter="url(#glow)">${frame("", "url(#pr)", 4)}</g>
${emblem(1.05, { card: "#1a0d3d", edge: "url(#pr)", b: "#ffffff", bits: "#FF6FD8", stripe: "#B98CFF", glow: "glow" })}
${word("url(#pr)")}${sweep("sh")}<rect width="${W}" height="${H}" rx="30" fill="none" stroke="#24104f" stroke-width="10"/></svg>`;
  } },
  gold: { name: "Gold Legendary", tier: "ultimate", svg() {
    seed = 23;
    const rays = Array.from({ length: 36 }, (_, i) => {
      const a = (i / 36) * Math.PI * 2, a2 = a + Math.PI / 72;
      const R = 520;
      return `<polygon points="${CX},${CY} ${(CX + Math.cos(a) * R).toFixed(1)},${(CY + Math.sin(a) * R).toFixed(1)} ${(CX + Math.cos(a2) * R).toFixed(1)},${(CY + Math.sin(a2) * R).toFixed(1)}"/>`;
    }).join("");
    const glints = Array.from({ length: 14 }, (_, i) => {
      const x = (rnd() * (W - 140) + 70).toFixed(0), y = (rnd() * (H - 140) + 70).toFixed(0), r = (8 + rnd() * 10).toFixed(1);
      return `<polygon class="gl g${i % 3}" points="${x},${y - r} ${+x + r * 0.22},${y - r * 0.22} ${+x + +r},${y} ${+x + r * 0.22},${+y + r * 0.22} ${x},${+y + +r} ${x - r * 0.22},${+y + r * 0.22} ${x - r},${y} ${x - r * 0.22},${y - r * 0.22}" fill="#FFF4C9"/>`;
    }).join("");
    const crown = `<g transform="translate(${CX},${CY - 170})"><path d="M-62,22 L-70,-22 L-34,2 L0,-34 L34,2 L70,-22 L62,22 Z" fill="url(#au)" stroke="#5a3a00" stroke-width="4" stroke-linejoin="round"/>
<circle cx="0" cy="-34" r="7" fill="#fff4c9"/><circle cx="-70" cy="-22" r="6" fill="#fff4c9"/><circle cx="70" cy="-22" r="6" fill="#fff4c9"/><rect x="-62" y="16" width="124" height="10" rx="3" fill="#5a3a00" opacity=".4"/></g>`;
    return head("gold", "Gold Legendary sleeve", `.rays{animation:spin 40s linear infinite;transform-origin:${CX}px ${CY}px}@keyframes spin{to{transform:rotate(360deg)}}
.gl{animation:gl 2.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}.g1{animation-delay:-.8s}.g2{animation-delay:-1.6s}@keyframes gl{0%,100%{transform:scale(0) rotate(0);opacity:0}45%{transform:scale(1) rotate(45deg);opacity:1}}`,
      sheen("sh", "#fffbe6", 0.5) + `<linearGradient id="au" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF1B8"/><stop offset=".3" stop-color="#FFC94D"/><stop offset=".55" stop-color="#B07A12"/><stop offset=".8" stop-color="#FFD978"/><stop offset="1" stop-color="#9A6A10"/></linearGradient>
<radialGradient id="bg" cx=".5" cy=".5" r=".7"><stop offset="0" stop-color="#3a2604"/><stop offset="1" stop-color="#120b01"/></radialGradient>`) +
      `<g clip-path="url(#clip)"><rect width="${W}" height="${H}" fill="url(#au)"/>
<rect x="30" y="30" width="${W - 60}" height="${H - 60}" rx="20" fill="url(#bg)"/>
<g class="rays" fill="#FFC94D" opacity=".12">${rays}</g>${glints}</g>
${frame(`<rect x="46" y="46" width="${W - 92}" height="${H - 92}" rx="12" fill="none" stroke="#FFC94D" stroke-opacity=".6" stroke-width="1.5"/>`, "#fff1b8", 2)}
${[[60, 60], [W - 60, 60], [60, H - 60], [W - 60, H - 60]].map(([x, y]) => `<polygon points="${x},${y - 16} ${x + 11},${y} ${x},${y + 16} ${x - 11},${y}" fill="url(#au)" stroke="#5a3a00" stroke-width="2"/>`).join("")}
${crown}${emblem(1, { card: "#2a1a02", edge: "url(#au)", b: "#FFE7A0", bits: "#FFC94D", stripe: "#FFC94D", glow: "glow" })}
${word("url(#au)", 112, 40)}
<g transform="translate(${CX},${CY + 190})"><rect x="-120" y="-26" width="240" height="44" rx="22" fill="#2a1a02" stroke="url(#au)" stroke-width="3"/>${text("LEGENDARY", 0, 8, 26, `fill="#FFE7A0"`, 4)}</g>
${sweep("sh")}<rect width="${W}" height="${H}" rx="30" fill="none" stroke="#7a5208" stroke-width="10"/></svg>`;
  } },
};

mkdirSync(OUT, { recursive: true });
for (const [id, s] of Object.entries(SLEEVES)) writeFileSync(`${OUT}/${id}.svg`, s.svg());
console.log("wrote", Object.keys(SLEEVES).length, "sleeves to", OUT);
export const SLEEVE_LIST = Object.entries(SLEEVES).map(([id, s]) => ({ id, name: s.name, tier: s.tier }));
