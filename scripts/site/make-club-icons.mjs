// Builds the animated Cardbit Club versions of the Latch & Friends icons (site only).
//   node scripts/site/make-club-icons.mjs
// Reads public/site/assets/cardbit-icon-*.{svg,webp} (ported theme art, unchanged) and writes
// public/site/img/club/cardbit-icon-<id>-club.svg: the same art with a gentle bob, a scanline sweep
// and a pulsing neon rim. Motion stops under prefers-reduced-motion.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const src = "public/site/assets";
const out = "public/site/img/club";
mkdirSync(out, { recursive: true });

const RIM = {
  latch: "#4057F5", "latch-gold": "#FFC94D", "latch-holo": "#B98CFF", blazebit: "#FF7A3D", driplink: "#3DB8FF", mossbit: "#5BE38A",
  zappix: "#FFE14D", cryobyte: "#8CE8FF", glitchog: "#FF4DD2", phantab: "#B07CFF", nimbyte: "#7DF9FF", wyrmware: "#FF4D6A",
};

const style = (id, rim) => `<style>
@keyframes cb-bob-${id}{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes cb-scan-${id}{0%{transform:translateY(-80px)}100%{transform:translateY(300px)}}
@keyframes cb-rim-${id}{0%,100%{stroke-opacity:.35}50%{stroke-opacity:1}}
.cb-bob-${id}{animation:cb-bob-${id} 2.6s ease-in-out infinite}
.cb-scan-${id}{animation:cb-scan-${id} 3.2s linear infinite}
.cb-rim-${id}{animation:cb-rim-${id} 1.8s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.cb-bob-${id},.cb-scan-${id},.cb-rim-${id}{animation:none}}
</style>`;

const overlay = (id, rim) => `
<defs><linearGradient id="scan-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="club-clip-${id}"><circle cx="128" cy="128" r="128"/></clipPath></defs>
<g clip-path="url(#club-clip-${id})"><rect class="cb-scan-${id}" x="0" y="0" width="256" height="60" fill="url(#scan-${id})"/></g>
<circle class="cb-rim-${id}" cx="128" cy="128" r="124" fill="none" stroke="${rim}" stroke-width="7"/>`;

const made = [];
for (const file of readdirSync(src)) {
  const m = /^cardbit-icon-([a-z-]+)\.(svg|webp)$/.exec(file);
  if (!m) continue;
  const [, id, ext] = m;
  const rim = RIM[id] || "#4057F5";
  let body;
  if (ext === "svg") {
    const svg = readFileSync(join(src, file), "utf8").replace(/<metadata[\s\S]*?<\/metadata>/g, "");
    const open = svg.match(/<svg[^>]*>/)[0];
    const inner = svg.slice(svg.indexOf(open) + open.length, svg.lastIndexOf("</svg>"));
    // Background = defs + the first two rects of the clipped group; everything after bobs.
    const defsEnd = inner.indexOf("</defs>") + 7;
    const defs = inner.slice(0, defsEnd);
    const rest = inner.slice(defsEnd);
    const g = rest.match(/<g clip-path="url\(#[^)]+\)">/)[0];
    const afterG = rest.slice(rest.indexOf(g) + g.length);
    const bg = afterG.match(/^(?:\s*<rect[^>]*\/>){2}/)?.[0] ?? "";
    const char = afterG.slice(bg.length).replace(/<\/g>\s*$/, "");
    body = `${defs}${g}${bg}<g class="cb-bob-${id}">${char}</g></g>`;
  } else {
    const b64 = readFileSync(join(src, file)).toString("base64");
    body = `<defs><clipPath id="c-${id}"><circle cx="128" cy="128" r="128"/></clipPath></defs><g clip-path="url(#c-${id})"><rect width="256" height="256" fill="#17213B"/>
<g class="cb-bob-${id}"><image href="data:image/webp;base64,${b64}" x="0" y="0" width="256" height="256" preserveAspectRatio="xMidYMid meet"/></g></g>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">${style(id.replace(/[^a-z]/g, ""), rim)}${body}${overlay(id.replace(/[^a-z]/g, ""), rim)}</svg>\n`;
  writeFileSync(join(out, `cardbit-icon-${id}-club.svg`), svg.replaceAll(`cb-bob-${id}"`, `cb-bob-${id.replace(/[^a-z]/g, "")}"`));
  made.push(id);
}
console.log(`made ${made.length} Club icons: ${made.join(", ")}`);
