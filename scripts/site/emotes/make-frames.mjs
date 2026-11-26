// Builds the Pack Pass portrait frames that sit around a member's avatar (chat, leaderboard, header, account).
//   node scripts/site/emotes/make-frames.mjs
// Writes public/site/img/pass/frames/<tier>.svg (256x256, transparent center). The avatar shows through a
// circle centered at (128,120) with radius 86: in CSS that is left 16.4%, top 13.3%, size 67.2% of the frame.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const OUT = "public/site/img/pass/frames";
const FONT = JSON.parse(readFileSync("scripts/site/emotes/art/outfit-800-glyphs.json", "utf8"));
export const HOLE = { cx: 128, cy: 120, r: 86 };

// Outfit ExtraBold text as paths (SVGs in <img> can't load web fonts), centered on (x, y baseline).
function text(str, x, y, size, attrs, track = 0) {
  const s = size / FONT.upm;
  const widths = [...str].map((ch) => FONT.glyphs[ch].adv * s + track);
  const total = widths.reduce((a, b) => a + b, 0) - track;
  let pen = x - total / 2;
  return [...str].map((ch, i) => {
    const g = `<path transform="translate(${pen.toFixed(2)},${y}) scale(${s.toFixed(4)})" d="${FONT.glyphs[ch].d}" ${attrs}/>`;
    pen += widths[i];
    return g;
  }).join("");
}
const diamond = (x, y, r, fill, stroke) => `<polygon points="${x},${y - r} ${x + r * 0.7},${y} ${x},${y + r} ${x - r * 0.7},${y}" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>`;
const star = (x, y, r, fill) => `<polygon points="${x},${y - r} ${x + r * 0.24},${y - r * 0.24} ${x + r},${y} ${x + r * 0.24},${y + r * 0.24} ${x},${y + r} ${x - r * 0.24},${y + r * 0.24} ${x - r},${y} ${x - r * 0.24},${y - r * 0.24}" fill="${fill}"/>`;
const { cx, cy, r } = HOLE;
const RM = `@media (prefers-reduced-motion:reduce){*{animation:none!important}}`;

function plate(label, { fill, stroke, textFill, w = 92, glow }) {
  const y = 206, h = 30;
  return `<g${glow ? ` filter="url(#${glow})"` : ""}><rect x="${cx - w / 2}" y="${y}" width="${w}" height="${h}" rx="15" fill="${fill}" stroke="${stroke}" stroke-width="3"/></g>
${text(label, cx, y + 21.5, 17, `fill="${textFill}"`, 1.2)}`;
}

const PLUS = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="Pack Pass Plus frame">
<style>.orbit{animation:spin 14s linear infinite;transform-origin:${cx}px ${cy}px}.pulse{animation:pulse 2.4s ease-in-out infinite}
@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:.55}50%{opacity:1}}${RM}</style>
<defs><linearGradient id="pl-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7DF3EA"/><stop offset="1" stop-color="#2EA8F0"/></linearGradient>
<filter id="pl-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<g class="orbit"><circle cx="${cx}" cy="${cy}" r="${r + 18}" fill="none" stroke="#7DF3EA" stroke-width="2" stroke-dasharray="3 9" opacity=".7"/></g>
<circle class="pulse" cx="${cx}" cy="${cy}" r="${r + 6}" fill="none" stroke="#2EE6F0" stroke-width="10" opacity=".35" filter="url(#pl-glow)"/>
<circle cx="${cx}" cy="${cy}" r="${r + 5}" fill="none" stroke="url(#pl-ring)" stroke-width="7"/>
<circle cx="${cx}" cy="${cy}" r="${r + 0.5}" fill="none" stroke="#07202a" stroke-width="2.5"/>
${diamond(cx, cy - r - 6, 9, "#7DF3EA", "#07202a")}${diamond(cx - r - 6, cy, 7, "#7DF3EA", "#07202a")}${diamond(cx + r + 6, cy, 7, "#7DF3EA", "#07202a")}
${plate("PLUS", { fill: "#0b2a33", stroke: "#2EE6F0", textFill: "#BFF7F2", w: 84 })}
</svg>`;

const PRO = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="Pack Pass Pro frame">
<style>.holo{animation:spin 6s linear infinite;transform-origin:${cx}px ${cy}px}.gem{animation:gem 2.4s ease-in-out infinite}.gem.g2{animation-delay:-.8s}.gem.g3{animation-delay:-1.6s}
.shine{animation:shine 3s ease-in-out infinite}
@keyframes spin{to{transform:rotate(360deg)}}@keyframes gem{0%,100%{opacity:.75}50%{opacity:1;filter:brightness(1.4)}}
@keyframes shine{0%,55%{opacity:0}70%{opacity:1}85%,100%{opacity:0}}${RM}</style>
<defs>
<linearGradient id="pr-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7DF3EA"/><stop offset=".35" stop-color="#B98CFF"/><stop offset=".65" stop-color="#FF6FD8"/><stop offset="1" stop-color="#FFE07A"/></linearGradient>
<mask id="pr-ring"><circle cx="${cx}" cy="${cy}" r="${r + 10}" fill="#fff"/><circle cx="${cx}" cy="${cy}" r="${r + 1}" fill="#000"/></mask>
<filter id="pr-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3.2"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<path d="M${cx - r - 6},${cy - 10} L${cx - r - 30},${cy - 34} L${cx - r - 22},${cy} L${cx - r - 34},${cy + 26} L${cx - r - 6},${cy + 14} Z" fill="#2a1450" stroke="#B98CFF" stroke-width="3" stroke-linejoin="round"/>
<path d="M${cx + r + 6},${cy - 10} L${cx + r + 30},${cy - 34} L${cx + r + 22},${cy} L${cx + r + 34},${cy + 26} L${cx + r + 6},${cy + 14} Z" fill="#2a1450" stroke="#FF6FD8" stroke-width="3" stroke-linejoin="round"/>
<circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="none" stroke="#B98CFF" stroke-width="12" opacity=".35" filter="url(#pr-glow)"/>
<g mask="url(#pr-ring)"><g class="holo"><rect x="${cx - r - 14}" y="${cy - r - 14}" width="${2 * r + 28}" height="${2 * r + 28}" fill="url(#pr-a)"/></g></g>
<circle cx="${cx}" cy="${cy}" r="${r + 10}" fill="none" stroke="#1a0c33" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="${r + 1}" fill="none" stroke="#1a0c33" stroke-width="2.5"/>
<g class="shine"><path d="M${cx - 60},${cy - 70} A${r + 5},${r + 5} 0 0 1 ${cx + 20},${cy - r - 4}" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".8"/></g>
<g class="gem">${diamond(cx, cy - r - 6, 11, "#FF6FD8", "#1a0c33")}</g>
<g class="gem g2">${diamond(cx - 66, cy - 62, 7, "#7DF3EA", "#1a0c33")}</g><g class="gem g3">${diamond(cx + 66, cy - 62, 7, "#FFE07A", "#1a0c33")}</g>
<g class="gem g3">${diamond(cx - 72, cy + 54, 6, "#B98CFF", "#1a0c33")}</g><g class="gem g2">${diamond(cx + 72, cy + 54, 6, "#B98CFF", "#1a0c33")}</g>
<defs><linearGradient id="pr-plate" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4B2A9A"/><stop offset="1" stop-color="#8a2a7a"/></linearGradient></defs>
${plate("PRO", { fill: "url(#pr-plate)", stroke: "#FF9AE6", textFill: "#ffffff", w: 74 })}
</svg>`;

// Ultimate: gold crown, laurel wings, animated shimmer and twinkles. Exclusive to Ultimate.
function laurel(side) {
  const s = side; // -1 left, 1 right
  const leaves = [];
  for (let i = 0; i < 6; i++) {
    const a = (200 - i * 26) * (Math.PI / 180);
    const rr = r + 22;
    const x = cx + s * Math.cos(a) * -rr, y = cy + Math.sin(a) * -rr * -1;
    const rot = s * (i * 26 - 20) + (s < 0 ? 180 : 0);
    leaves.push(`<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="13" ry="5.5" transform="rotate(${(-s * (110 - i * 26)).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="url(#ul-gold)" stroke="#5a3a00" stroke-width="1.4"/>`);
  }
  return leaves.join("");
}
const ULTIMATE = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="Pack Pass Ultimate frame">
<style>.sweep{animation:sweep 2.8s ease-in-out infinite}.tw{animation:tw 2.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}.tw.t2{animation-delay:-.8s}.tw.t3{animation-delay:-1.6s}
.aura{animation:aura 2.4s ease-in-out infinite}.crown{animation:crown 2.4s ease-in-out infinite;transform-origin:${cx}px 30px}
@keyframes sweep{0%{transform:translateX(-200px)}60%,100%{transform:translateX(200px)}}
@keyframes tw{0%,100%{transform:scale(0) rotate(0);opacity:0}40%{transform:scale(1) rotate(45deg);opacity:1}70%{transform:scale(0) rotate(90deg);opacity:0}}
@keyframes aura{0%,100%{opacity:.45}50%{opacity:.9}}@keyframes crown{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}${RM}</style>
<defs>
<linearGradient id="ul-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF1B8"/><stop offset=".45" stop-color="#FFC94D"/><stop offset="1" stop-color="#C47F12"/></linearGradient>
<linearGradient id="ul-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF1B8"/><stop offset=".5" stop-color="#FFB627"/><stop offset="1" stop-color="#FFE38A"/></linearGradient>
<linearGradient id="ul-sh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<mask id="ul-mask"><circle cx="${cx}" cy="${cy}" r="${r + 11}" fill="#fff"/><circle cx="${cx}" cy="${cy}" r="${r + 1}" fill="#000"/>
<path d="M${cx - 34},40 L${cx - 40},12 L${cx - 18},26 L${cx},4 L${cx + 18},26 L${cx + 40},12 L${cx + 34},40 Z" fill="#fff"/></mask>
<filter id="ul-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<circle class="aura" cx="${cx}" cy="${cy}" r="${r + 8}" fill="none" stroke="#FFC94D" stroke-width="16" opacity=".5" filter="url(#ul-glow)"/>
${laurel(-1)}${laurel(1)}
<circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="none" stroke="url(#ul-ring)" stroke-width="10"/>
<circle cx="${cx}" cy="${cy}" r="${r + 11}" fill="none" stroke="#5a3a00" stroke-width="1.6"/><circle cx="${cx}" cy="${cy}" r="${r + 1}" fill="none" stroke="#5a3a00" stroke-width="2.4"/>
<g class="crown"><path d="M${cx - 34},40 L${cx - 40},12 L${cx - 18},26 L${cx},4 L${cx + 18},26 L${cx + 40},12 L${cx + 34},40 Z" fill="url(#ul-gold)" stroke="#5a3a00" stroke-width="2.4" stroke-linejoin="round" filter="url(#ul-glow)"/>
<circle cx="${cx}" cy="7" r="4.5" fill="#FF4D8D" stroke="#5a3a00" stroke-width="1.4"/><circle cx="${cx - 40}" cy="14" r="3.6" fill="#7DF3EA" stroke="#5a3a00" stroke-width="1.2"/><circle cx="${cx + 40}" cy="14" r="3.6" fill="#7DF3EA" stroke="#5a3a00" stroke-width="1.2"/>
${diamond(cx, 31, 6, "#B98CFF", "#5a3a00")}</g>
<g mask="url(#ul-mask)"><g class="sweep"><rect x="0" y="0" width="60" height="256" fill="url(#ul-sh)" transform="skewX(-20)"/></g></g>
<g class="tw">${star(cx - 92, cy - 70, 9, "#FFF1B8")}</g><g class="tw t2">${star(cx + 96, cy - 58, 7, "#FFF1B8")}</g><g class="tw t3">${star(cx + 84, cy + 74, 8, "#FFF1B8")}</g><g class="tw t2">${star(cx - 88, cy + 66, 6, "#FFF1B8")}</g>
<defs><linearGradient id="ul-plate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2400"/><stop offset="1" stop-color="#1e1300"/></linearGradient></defs>
${plate("ULTIMATE", { fill: "url(#ul-plate)", stroke: "#FFC94D", textFill: "#FFE38A", w: 128 })}
</svg>`;

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/plus.svg`, PLUS());
writeFileSync(`${OUT}/pro.svg`, PRO());
writeFileSync(`${OUT}/ultimate.svg`, ULTIMATE());
console.log("wrote 3 frames to " + OUT);
