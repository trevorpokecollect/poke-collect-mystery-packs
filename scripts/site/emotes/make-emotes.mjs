// Builds the Pack Pass animated emotes for Latch & Friends from the reference spec (characters.mjs).
//   node scripts/site/emotes/make-emotes.mjs [characterId ...]
// Writes public/site/img/pass/emotes/<id>-<emote>.svg. Each file is a self-contained animated SVG
// (CSS keyframes, no scripts, no external files) that loops seamlessly and holds a clean still pose
// under prefers-reduced-motion.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHARACTERS, EMOTES } from "./characters.mjs";

const SRC = "public/site/assets";
const OUT = "public/site/img/pass/emotes";
const LOOP = 2.4; // seconds, every emote

// ---------- base art ----------
function baseParts(c) {
  if (c.raster) {
    // Transparent cut of the approved Latch render (scripts/site/emotes/art), on the Friends-style backdrop.
    const b64 = readFileSync(join("scripts/site/emotes/art", `${c.id}-cut.webp`)).toString("base64");
    const r = c.colors.rim;
    const defs = `<radialGradient id="bg-${c.id}" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="${c.colors.deep}"/><stop offset="1" stop-color="#121426"/></radialGradient>
<pattern id="grid-${c.id}" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 0H0V16" fill="none" stroke="${r}" stroke-opacity=".10" stroke-width="1"/></pattern>`;
    return {
      bg: `<rect width="256" height="256" fill="url(#bg-${c.id})"/><rect width="256" height="256" fill="url(#grid-${c.id})"/>`,
      body: `<ellipse cx="128" cy="222" rx="62" ry="8" fill="#000" opacity=".3"/><image href="data:image/webp;base64,${b64}" x="42" y="44" width="172" height="180"/>`,
      defs,
    };
  }
  let svg = readFileSync(join(SRC, c.base), "utf8")
    .replace(/<metadata>[\s\S]*?<\/metadata>/g, "")
    .replace(/\s+xmlns:c2pa="[^"]*"/, "");
  const defs = (svg.match(/<defs>[\s\S]*?<\/defs>/) || [""])[0];
  const inner = svg.slice(svg.indexOf("</defs>") + 7, svg.lastIndexOf("</svg>"));
  // inner = <g clip-path=...> bgRect gridRect ...body... </g>
  const open = inner.match(/<g clip-path="[^"]*">/)[0];
  let rest = inner.slice(inner.indexOf(open) + open.length, inner.lastIndexOf("</g>"));
  const els = rest.split(/(?=<)/);
  const bg = [], body = [];
  let i = 0;
  for (const e of els) {
    if (!e.trim()) continue;
    if (i < 2 && e.startsWith("<rect width=\"256\"")) { bg.push(e); i++; continue; }
    i = 2;
    if (c.strip.some((s) => e.startsWith("<" + s))) continue;
    body.push(e);
  }
  // Keep the shared ids unique per emote file is unnecessary (one character per file).
  return { bg: bg.join(""), body: body.join(""), defs: defs.replace(/^<defs>|<\/defs>$/g, "") };
}

// ---------- shapes ----------
const HEART = "M0,8 C-12,0 -11,-9 -5.5,-9 C-2.5,-9 -1,-7 0,-5 C1,-7 2.5,-9 5.5,-9 C11,-9 12,0 0,8 Z";
const PARTICLE = {
  fire: (c) => `<path d="M0,-12 C6,-4 8,2 4,8 C2,11 -2,11 -4,8 C-8,2 -6,-4 0,-12 Z" fill="${c.colors.rim}"/><path d="M0,-4 C3,0 4,3 2,6 C1,7 -1,7 -2,6 C-4,3 -3,0 0,-4 Z" fill="${c.colors.pop}"/>`,
  water: (c) => `<path d="M0,-11 C5,-3 8,2 8,5 A8,8 0 0 1 -8,5 C-8,2 -5,-3 0,-11 Z" fill="${c.colors.rim}"/><ellipse cx="-3" cy="3" rx="2" ry="3" fill="${c.colors.pop}" opacity=".8"/>`,
  grass: (c) => `<path d="M0,-11 C8,-6 8,6 0,11 C-8,6 -8,-6 0,-11 Z" fill="${c.colors.rim}"/><path d="M0,-8 V9" stroke="${c.colors.deep}" stroke-width="1.6"/>`,
  electric: (c) => `<polygon points="3,-12 -6,2 0,2 -3,12 7,-3 1,-3 5,-12" fill="${c.colors.accent}" stroke="#fff" stroke-width="1"/>`,
  ice: (c) => `<g stroke="${c.colors.accent}" stroke-width="2.6" stroke-linecap="round"><path d="M0,-10 V10 M-8.7,-5 L8.7,5 M-8.7,5 L8.7,-5"/><path d="M-3,-7 L0,-4 L3,-7 M-3,7 L0,4 L3,7" stroke-width="1.8"/></g>`,
  crystal: (c) => `<polygon points="0,-12 6,0 0,12 -6,0" fill="${c.colors.accent}"/><polygon points="0,-12 6,0 0,0" fill="${c.colors.pop}" opacity=".8"/>`,
  ghost: (c) => `<path d="M-7,6 V-2 A7,7 0 0 1 7,-2 V6 L4,3 L1,6 L-2,3 L-5,6 Z" fill="${c.colors.accent}" opacity=".9"/><rect x="-4" y="-3" width="2" height="3" fill="${c.colors.deep}"/><rect x="2" y="-3" width="2" height="3" fill="${c.colors.deep}"/>`,
  wind: (c) => `<path d="M-10,0 C-4,-8 8,-8 8,0 C8,5 2,6 0,2" stroke="${c.colors.accent}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  dragon: (c) => `<path d="M0,-12 C6,-4 8,2 4,8 C2,11 -2,11 -4,8 C-8,2 -6,-4 0,-12 Z" fill="${c.colors.rim}"/><path d="M0,-4 C3,0 4,3 2,6 C1,7 -1,7 -2,6 C-4,3 -3,0 0,-4 Z" fill="${c.colors.pop}"/>`,
  card: (c) => `<rect x="-6" y="-9" width="12" height="17" rx="2" fill="#141820" stroke="${c.colors.rim}" stroke-width="2.4"/><rect x="2" y="-11" width="4" height="4" fill="${c.colors.rim}"/>`,
  gold: (c) => `<circle r="8" fill="${c.colors.rim}" stroke="${c.colors.deep}" stroke-width="2"/><path d="M-2,-4 H2 M0,-4 V4 M-2,4 H2" stroke="${c.colors.deep}" stroke-width="2"/>`,
  holo: (c) => `<polygon points="0,-11 3,-3 11,0 3,3 0,11 -3,3 -11,0 -3,-3" fill="${c.colors.pop}"/><polygon points="0,-6 1.6,-1.6 6,0 1.6,1.6 0,6 -1.6,1.6 -6,0 -1.6,-1.6" fill="${c.colors.accent}"/>`,
};
const sparkle = (fill) => `<polygon points="0,-9 2.2,-2.2 9,0 2.2,2.2 0,9 -2.2,2.2 -9,0 -2.2,-2.2" fill="${fill}"/>`;

// ---------- faces ----------
// All faces use the screen-glyph look: white marks on the dark screen, like the starter icons.
function eyes(kind, c, cls = "") {
  const { cx, eyeY: y, dx, eyeW: w } = c.face;
  const L = cx - dx, R = cx + dx;
  const g = (inner) => `<g class="${cls}">${inner}</g>`;
  switch (kind) {
    case "squint": // > <
      return g(`<path d="M${L - 9},${y - 8} L${L + 7},${y} L${L - 9},${y + 8}" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M${R + 9},${y - 8} L${R - 7},${y} L${R + 9},${y + 8}" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
    case "happy": // ^ ^
      return g(`<path d="M${L - 10},${y + 5} L${L},${y - 6} L${L + 10},${y + 5}" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M${R - 10},${y + 5} L${R},${y - 6} L${R + 10},${y + 5}" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
    case "heart":
      return g(`<g class="beat" style="transform-origin:${L}px ${y}px"><path d="${HEART}" transform="translate(${L},${y + 1}) scale(${w / 20})" fill="#FF4D8D" stroke="#fff" stroke-width="1.6"/></g>
<g class="beat" style="transform-origin:${R}px ${y}px"><path d="${HEART}" transform="translate(${R},${y + 1}) scale(${w / 20})" fill="#FF4D8D" stroke="#fff" stroke-width="1.6"/></g>`);
    case "star":
      return g([L, R].map((x) => `<g class="beat" style="transform-origin:${x}px ${y}px"><polygon transform="translate(${x},${y}) scale(${w / 20})" points="0,-11 3,-3.5 11,-3.5 4.5,1.5 7,10 0,5 -7,10 -4.5,1.5 -11,-3.5 -3,-3.5" fill="#FFD24D" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></g>`).join(""));
    case "wide":
      return g(`<circle cx="${L}" cy="${y}" r="${w / 2 + 1}" fill="#fff"/><circle cx="${R}" cy="${y}" r="${w / 2 + 1}" fill="#fff"/>
<circle class="pupil" cx="${L}" cy="${y}" r="3.6" fill="#141820"/><circle class="pupil" cx="${R}" cy="${y}" r="3.6" fill="#141820"/>`);
  }
}
function mouth(kind, c, cls = "") {
  const { cx, mouthY: y } = c.face;
  switch (kind) {
    case "open": // big D
      return `<g class="${cls}" style="transform-origin:${cx}px ${y}px"><path d="M${cx - 13},${y - 3} H${cx + 13} Q${cx + 13},${y + 15} ${cx},${y + 15} Q${cx - 13},${y + 15} ${cx - 13},${y - 3} Z" fill="#3a0d1c" stroke="#fff" stroke-width="3.5" stroke-linejoin="round"/>
<path d="M${cx - 6},${y + 10} Q${cx},${y + 4} ${cx + 6},${y + 10} Q${cx},${y + 14} ${cx - 6},${y + 10} Z" fill="#FF6F91"/></g>`;
    case "smile":
      return `<path d="M${cx - 8},${y - 1} Q${cx},${y + 8} ${cx + 8},${y - 1}" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
    case "o":
      return `<g class="${cls}" style="transform-origin:${cx}px ${y + 3}px"><ellipse cx="${cx}" cy="${y + 3}" rx="6" ry="8" fill="#141820" stroke="#fff" stroke-width="3.5"/></g>`;
  }
}
const blush = (c) => {
  const { cx, eyeY: y, dx } = c.face;
  return `<g class="blush" fill="#FF6F91" opacity=".75"><rect x="${cx - dx - 14}" y="${y + 11}" width="9" height="4" rx="2"/><rect x="${cx - dx - 4}" y="${y + 11}" width="5" height="4" rx="2" opacity=".6"/>
<rect x="${cx + dx + 5}" y="${y + 11}" width="9" height="4" rx="2"/><rect x="${cx + dx - 1}" y="${y + 11}" width="5" height="4" rx="2" opacity=".6"/></g>`;
};
// Raster Latch: cover the starter face with a screen-colored patch first.
const patch = (c) => {
  if (!c.raster) return "";
  const p = c.face.patch;
  return `<defs><linearGradient id="patch-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#35373d"/><stop offset="1" stop-color="#25292e"/></linearGradient>
<filter id="patch-f" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="1.6"/></filter></defs>
<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8" fill="url(#patch-g)" filter="url(#patch-f)"/>`;
};

// ---------- particles ----------
// n particles that fly from (ox,oy) along angles; each loops with a stagger.
function burst(c, { n = 8, ox, oy, dist = 70, spread = 360, start = -90, size = 1, cls = "fly", delayStep, shape }) {
  const out = [];
  const draw = shape || PARTICLE[c.element];
  for (let i = 0; i < n; i++) {
    const a = ((start - spread / 2 + (spread / n) * (i + 0.5)) * Math.PI) / 180;
    const dx = Math.round(Math.cos(a) * dist), dy = Math.round(Math.sin(a) * dist);
    const d = ((delayStep ?? LOOP / n) * i).toFixed(2);
    const rot = Math.round((a * 180) / Math.PI + 90);
    out.push(`<g transform="translate(${ox},${oy})"><g class="${cls}" style="--dx:${dx}px;--dy:${dy}px;--r:${rot}deg;animation-delay:-${d}s"><g transform="scale(${size})">${draw(c)}</g></g></g>`);
  }
  return out.join("\n");
}
function rise(c, { n = 3, xs, y0 = 210, h = 120, size = 1, shape, cls = "rise" }) {
  const draw = shape || PARTICLE[c.element];
  return xs.slice(0, n).map((x, i) => {
    const d = ((LOOP / n) * i).toFixed(2);
    return `<g transform="translate(${x},${y0})"><g class="${cls}" style="--h:-${h}px;--sway:${i % 2 ? 8 : -8}px;animation-delay:-${d}s"><g transform="scale(${size})">${draw(c)}</g></g></g>`;
  }).join("\n");
}
const heartShape = (c) => () => `<path d="${HEART}" fill="#FF4D8D" stroke="#fff" stroke-width="1.2"/><g transform="translate(7,-8) scale(.45)">${PARTICLE[c.element](c)}</g>`;

// ---------- emote recipes ----------
// Signature move per element for Hype; shared vocabulary everywhere else, colored and shaped per character.
function hypeSignature(c) {
  const top = { x: c.face.cx, y: 70 };
  switch (c.element) {
    case "electric":
      return `<g class="flash"><rect width="256" height="256" fill="${c.colors.accent}" opacity=".18"/></g>
<g class="strike"><polygon points="70,10 54,48 66,48 50,92 86,40 72,40 84,10" fill="${c.colors.accent}" stroke="#fff" stroke-width="2"/></g>
<g class="strike s2"><polygon points="196,6 182,44 194,44 178,84 214,34 200,34 212,6" fill="${c.colors.accent}" stroke="#fff" stroke-width="2"/></g>`;
    case "fire": case "dragon":
      return `<g class="flare" style="transform-origin:${top.x}px 110px">${[0, 1, 2].map((i) => `<g transform="translate(${top.x - 26 + i * 26},${78 - (i === 1 ? 14 : 0)}) scale(${i === 1 ? 2.2 : 1.6})">${PARTICLE.fire(c)}</g>`).join("")}</g>`;
    case "water":
      return `<g class="ring"><ellipse cx="${c.face.cx}" cy="222" rx="40" ry="8" fill="none" stroke="${c.colors.accent}" stroke-width="3"/></g><g class="ring r2"><ellipse cx="${c.face.cx}" cy="222" rx="40" ry="8" fill="none" stroke="${c.colors.rim}" stroke-width="2"/></g>`;
    case "grass":
      return `<g class="spin" style="transform-origin:${c.face.cx}px 140px">${burst(c, { n: 6, ox: c.face.cx, oy: 140, dist: 82, cls: "still", size: 1.1 })}</g>`;
    case "ice":
      return `<g class="frost"><circle cx="${c.face.cx}" cy="140" r="96" fill="none" stroke="${c.colors.accent}" stroke-width="3" stroke-dasharray="4 10"/></g>`;
    case "crystal":
      return ""; // handled as an RGB glitch on the whole body
    case "ghost":
      return "";
    case "wind":
      return `<g class="gust"><path d="M24,92 H84 M14,116 H70 M180,170 H240 M190,194 H246" stroke="${c.colors.accent}" stroke-width="5" stroke-linecap="round"/></g>`;
    default: // card / gold / holo
      return `<g class="fan" style="transform-origin:${c.face.cx}px 200px">${[-34, -12, 12, 34].map((r) => `<g transform="rotate(${r} ${c.face.cx} 200) translate(${c.face.cx},62) scale(1.5)">${PARTICLE[c.element](c)}</g>`).join("")}</g>`;
  }
}

// ---------- Daily Spin mascots ----------
// "happy" is the Rewards page spin art (not a Pack Pass emote): a calm, cheerful loop themed per element.
function happySignature(c) {
  const cx = c.face.cx;
  switch (c.element) {
    case "grass": // leaves and petals drift up while Mossbit sways
      return { body: "sway", back: burst(c, { n: 5, ox: cx, oy: 120, dist: 96, cls: "twinkle", size: 0.7, delayStep: 0.48, shape: () => sparkle(c.colors.accent) }),
        front: rise(c, { n: 4, xs: [cx - 78, cx + 74, cx - 58, cx + 56], y0: 214, h: 150, size: 1.2 }) };
    case "fire": // head flares, embers rise
      return { body: "hop", back: `<g class="flare" style="transform-origin:${cx}px 110px"><g transform="translate(${cx},70) scale(2.6)">${PARTICLE.fire(c)}</g></g>`,
        front: rise(c, { n: 5, xs: [cx - 70, cx + 66, cx - 52, cx + 50], y0: 200, h: 170, size: 0.9 }) };
    case "ice": // frost ring turns, snowflakes fall
      return { body: "sway", back: `<g class="frost"><circle cx="${cx}" cy="140" r="96" fill="none" stroke="${c.colors.accent}" stroke-width="3" stroke-dasharray="4 10"/></g>`,
        front: rise(c, { n: 5, xs: [cx - 80, cx + 76, cx - 40, cx + 42, cx + 4], y0: -14, h: 260, size: 0.9, cls: "rain" }) };
    case "gold": // coins pop up and glints twinkle
      return { body: "hop", back: burst(c, { n: 5, ox: cx, oy: 120, dist: 100, cls: "twinkle", size: 0.9, delayStep: 0.48, shape: () => sparkle(c.colors.pop) }) +
        burst(c, { n: 6, ox: cx, oy: 212, dist: 160, spread: 130, start: -90, cls: "fly", size: 1.1 }), front: "" };
    case "dragon": // proud wing-flap float with dragon fire puffs
      return { body: "float", back: `<g class="flare" style="transform-origin:${cx}px 130px">${[-1, 1].map((s) => `<g transform="translate(${cx + s * 86},120) rotate(${s * 24}) scale(1.6)">${PARTICLE.dragon(c)}</g>`).join("")}</g>` +
        rise(c, { n: 4, xs: [cx - 76, cx + 74, cx - 50, cx + 50], y0: 196, h: 160, size: 0.85 }), front: "" };
    case "holo": // rainbow halo turns, holo prisms twinkle
      return { body: "float", back: `<defs><linearGradient id="holo-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF6FD8"/><stop offset=".33" stop-color="#FFE07A"/><stop offset=".66" stop-color="#7DF3EA"/><stop offset="1" stop-color="#B98CFF"/></linearGradient></defs>
<g class="halo" style="transform-origin:${cx}px 132px"><circle cx="${cx}" cy="132" r="100" fill="none" stroke="url(#holo-ring)" stroke-width="5" stroke-dasharray="18 10" stroke-linecap="round" opacity=".9"/></g>`,
        front: burst(c, { n: 6, ox: cx, oy: 128, dist: 98, cls: "twinkle", size: 1, delayStep: 0.4 }) };
    default:
      return { body: "hop", back: burst(c, { n: 5, ox: cx, oy: 128, dist: 98, cls: "twinkle", size: 1, delayStep: 0.48 }), front: "" };
  }
}

function emoteSvg(c, emote) {
  const base = baseParts(c);
  const cx = c.face.cx;
  let back = "", front = "", face = "", bodyCls = "", extraCss = "";
  const glitch = c.element === "crystal";
  const ghost = c.element === "ghost";
  switch (emote) {
    case "hype":
      bodyCls = "jump";
      face = eyes("squint", c) + mouth("open", c, "chomp");
      back = hypeSignature(c) + burst(c, { n: 8, ox: cx, oy: 140, dist: 100, size: 1.6 });
      if (glitch) front = `<g class="rgb">${burst(c, { n: 5, ox: cx, oy: 120, dist: 70, cls: "fly", size: 0.9 })}</g>`;
      break;
    case "love":
      bodyCls = "sway";
      face = eyes("heart", c) + mouth("smile", c) + blush(c);
      front = rise(c, { n: 3, xs: [cx - 62, cx + 60, cx - 10], y0: 120, h: 110, size: 1.25, shape: heartShape(c) });
      back = burst(c, { n: 6, ox: cx, oy: 130, dist: 100, cls: "twinkle", size: 0.8, delayStep: 0.4, shape: () => sparkle(c.colors.accent) });
      break;
    case "lol":
      bodyCls = "shake";
      face = eyes("happy", c) + mouth("open", c, "laugh") +
        [-1, 1].map((s) => `<g transform="translate(${cx + s * (c.face.dx + 12)},${c.face.eyeY + 4})"><g class="tear" style="--tx:${s * 20}px"><path d="M0,-9 C4.5,-1.5 7.5,3 7.5,6 A7.5,7.5 0 0 1 -7.5,6 C-7.5,3 -4.5,-1.5 0,-9 Z" fill="#7FD3FF" stroke="#fff" stroke-width="1.4"/></g></g>`).join("") +
        [-1, 1].map((s) => `<g transform="translate(${cx + s * (c.face.dx + 12)},${c.face.eyeY + 4})"><g class="tear t2" style="--tx:${s * 24}px"><path d="M0,-9 C4.5,-1.5 7.5,3 7.5,6 A7.5,7.5 0 0 1 -7.5,6 C-7.5,3 -4.5,-1.5 0,-9 Z" fill="#7FD3FF" stroke="#fff" stroke-width="1.4"/></g></g>`).join("");
      back = `<g class="quake"><path d="M36,120 l-14,-6 M34,140 h-16 M36,160 l-14,6 M220,120 l14,-6 M222,140 h16 M220,160 l14,6" stroke="${c.colors.accent}" stroke-width="4" stroke-linecap="round"/></g>` +
        burst(c, { n: 4, ox: cx, oy: 70, dist: 40, spread: 140, cls: "pop", size: 0.8 });
      break;
    case "shock":
      bodyCls = "jolt";
      face = eyes("wide", c) + mouth("o", c, "gasp");
      front = `<g class="alert" style="transform-origin:${cx + 52}px 56px"><g transform="translate(${cx + 52},40)"><rect x="-11" y="-14" width="22" height="40" rx="6" fill="${c.colors.rim}" stroke="#fff" stroke-width="2.5"/><rect x="-3" y="-8" width="6" height="18" rx="2" fill="#141820"/><rect x="-3" y="14" width="6" height="6" rx="2" fill="#141820"/></g></g>` +
        [0, 1].map((i) => `<g transform="translate(${cx - c.face.dx - 26 + i * 6},${c.face.eyeY - 18 + i * 14})"><g class="sweat" style="animation-delay:-${i * 0.5}s"><path d="M0,-7 C4,-1 6,2 6,5 A6,6 0 0 1 -6,5 C-6,2 -4,-1 0,-7 Z" fill="#7FD3FF" stroke="#fff" stroke-width="1"/></g></g>`).join("");
      back = burst(c, { n: 7, ox: cx, oy: 150, dist: 104, spread: 160, start: -90, cls: "zing", size: 1.05, delayStep: 0 });
      break;
    case "happy": {
      const h = happySignature(c);
      bodyCls = h.body;
      const excited = ["fire", "gold", "dragon"].includes(c.element);
      face = eyes("happy", c) + (excited ? mouth("open", c, "chomp") : mouth("smile", c)) + blush(c);
      back = h.back;
      front = h.front;
      extraCss = `.hop{animation:hop ${LOOP}s cubic-bezier(.3,0,.3,1) infinite}
@keyframes hop{0%,50%,100%{transform:translateY(0) scale(1,1)}12%{transform:translateY(3px) scale(1.04,.95)}26%{transform:translateY(-12px) scale(.98,1.03)}40%{transform:translateY(0) scale(1.03,.97)}}`;
      break;
    }
    case "legend": {
      bodyCls = "float";
      const cyw = c.face.crownY;
      face = eyes("star", c) + mouth("open", c, "chomp");
      back = `<g class="halo" style="transform-origin:${cx}px 130px"><circle cx="${cx}" cy="130" r="98" fill="none" stroke="#FFC94D" stroke-width="5" stroke-dasharray="2 12" stroke-linecap="round"/></g>
<circle class="aura" cx="${cx}" cy="140" r="78" fill="#FFC94D" opacity=".18"/>` +
        burst(c, { n: 6, ox: cx, oy: 130, dist: 104, cls: "twinkle", size: 1, delayStep: 0.4, shape: () => sparkle("#FFF1B8") });
      front = `<g class="crown" style="transform-origin:${cx}px ${cyw + 14}px"><g transform="translate(${cx},${cyw}) rotate(-8)">
<path d="M-24,14 L-28,-8 L-12,3 L0,-14 L12,3 L28,-8 L24,14 Z" fill="#FFC94D" stroke="#5a3a00" stroke-width="2.4" stroke-linejoin="round"/>
<path d="M-24,14 H24 V19 H-24 Z" fill="#E09A1A" stroke="#5a3a00" stroke-width="2"/>
<circle cy="-12" r="3.6" fill="#FF4D8D" stroke="#5a3a00" stroke-width="1.2"/><circle cx="-27" cy="-7" r="3" fill="#7DF3EA" stroke="#5a3a00" stroke-width="1"/><circle cx="27" cy="-7" r="3" fill="#7DF3EA" stroke="#5a3a00" stroke-width="1"/>
<path d="M-16,2 L-10,8" stroke="#FFF1B8" stroke-width="2.5" stroke-linecap="round"/></g></g>` +
        rise(c, { n: 4, xs: [cx - 80, cx + 78, cx - 40, cx + 44], y0: -10, h: 230, size: 1.1, cls: "rain", shape: () => PARTICLE.gold({ colors: { rim: "#FFC94D", deep: "#9A6A10" } }) });
      break;
    }
  }
  const css = `
.body{transform-origin:128px 226px}
.jump{animation:jump ${LOOP}s cubic-bezier(.3,0,.3,1) infinite}
@keyframes jump{0%,100%{transform:translateY(0) scale(1,1)}8%{transform:translateY(4px) scale(1.06,.92)}22%{transform:translateY(-22px) scale(.96,1.05)}36%{transform:translateY(0) scale(1.05,.94)}44%{transform:translateY(0) scale(1)}52%{transform:translateY(3px) scale(1.05,.93)}64%{transform:translateY(-16px) scale(.97,1.04)}76%{transform:translateY(0) scale(1.04,.95)}84%{transform:translateY(0) scale(1)}}
.sway{animation:sway ${LOOP}s ease-in-out infinite}
@keyframes sway{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}
.shake{animation:shake ${LOOP / 8}s linear infinite}
@keyframes shake{0%,100%{transform:translate(0,0) rotate(0)}25%{transform:translate(-3px,-2px) rotate(-3deg)}50%{transform:translate(0,-4px) rotate(0)}75%{transform:translate(3px,-2px) rotate(3deg)}}
.jolt{animation:jolt ${LOOP}s cubic-bezier(.2,.9,.3,1) infinite}
@keyframes jolt{0%{transform:translateY(0) scale(1)}6%{transform:translateY(-18px) scale(.94,1.08)}12%{transform:translateY(-14px) scale(1.02,.98)}14%,18%,22%{transform:translate(-2px,-14px)}16%,20%{transform:translate(2px,-14px)}70%{transform:translateY(-14px)}84%,100%{transform:translateY(0)}}
.chomp{animation:chomp ${LOOP / 4}s ease-in-out infinite}
@keyframes chomp{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.6)}}
.laugh{animation:chomp ${LOOP / 8}s ease-in-out infinite}
.gasp{animation:gasp ${LOOP}s ease-out infinite}
@keyframes gasp{0%{transform:scale(.4)}10%,70%{transform:scale(1.25)}84%,100%{transform:scale(1)}}
.pupil{animation:pupil ${LOOP}s steps(1) infinite}
@keyframes pupil{0%,8%{r:3.6px}9%,70%{r:2px}71%,100%{r:3.6px}}
.beat{animation:beat ${LOOP / 3}s ease-in-out infinite}
@keyframes beat{0%,100%{transform:scale(1)}15%{transform:scale(1.28)}30%{transform:scale(.96)}45%{transform:scale(1.14)}}
.blush{animation:blush ${LOOP}s ease-in-out infinite}
@keyframes blush{0%,100%{opacity:.5}50%{opacity:.95}}
.fly{animation:fly ${LOOP}s ease-out infinite;opacity:0}
@keyframes fly{0%{transform:translate(0,0) rotate(0) scale(.3);opacity:0}12%{opacity:1}70%{opacity:1}100%{transform:translate(var(--dx),var(--dy)) rotate(var(--r)) scale(1);opacity:0}}
.zing{animation:zing ${LOOP}s cubic-bezier(.15,.8,.3,1) infinite;opacity:0}
@keyframes zing{0%,4%{transform:translate(0,0) scale(.2);opacity:0}8%{opacity:1}40%{transform:translate(var(--dx),var(--dy)) scale(1);opacity:1}60%,100%{transform:translate(var(--dx),var(--dy)) scale(1);opacity:0}}
.pop{animation:popk ${LOOP / 2}s ease-out infinite;opacity:0}
@keyframes popk{0%{transform:translate(0,0) scale(.2);opacity:0}20%{opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(1);opacity:0}}
.twinkle{animation:twinkle ${LOOP}s ease-in-out infinite}
@keyframes twinkle{0%,100%{transform:translate(var(--dx),var(--dy)) scale(0);opacity:0}30%{transform:translate(var(--dx),var(--dy)) scale(1) rotate(45deg);opacity:1}60%{transform:translate(var(--dx),var(--dy)) scale(0) rotate(90deg);opacity:0}}
.still{transform:translate(var(--dx),var(--dy))}
.rise{animation:rise ${LOOP}s ease-out infinite;opacity:0}
@keyframes rise{0%{transform:translate(0,0) scale(.3);opacity:0}15%{opacity:1;transform:translate(calc(var(--sway) * -1),calc(var(--h) * .2)) scale(1)}50%{transform:translate(var(--sway),calc(var(--h) * .55)) scale(1.05)}80%{opacity:1}100%{transform:translate(0,var(--h)) scale(.8);opacity:0}}
.tear{animation:tear ${LOOP / 2}s ease-in infinite;opacity:0}
.tear.t2{animation-delay:-${LOOP / 4}s}
@keyframes tear{0%{transform:translate(0,0) scale(.4);opacity:0}15%{opacity:1}100%{transform:translate(var(--tx),34px) scale(1.1);opacity:0}}
.sweat{animation:sweat ${LOOP}s ease-in infinite}
@keyframes sweat{0%,10%{transform:translateY(0);opacity:0}20%{opacity:1}80%{transform:translateY(16px);opacity:1}100%{transform:translateY(22px);opacity:0}}
.alert{animation:alert ${LOOP}s cubic-bezier(.2,1.6,.4,1) infinite}
@keyframes alert{0%,4%{transform:scale(0) rotate(-20deg)}14%{transform:scale(1.2) rotate(8deg)}22%,70%{transform:scale(1) rotate(0)}78%{transform:scale(1.1)}90%,100%{transform:scale(0)}}
.quake{animation:quake ${LOOP / 4}s steps(2) infinite}
@keyframes quake{0%{opacity:1}50%{opacity:.25}}
.flash{animation:flash ${LOOP}s steps(1) infinite;opacity:0}
@keyframes flash{0%,18%{opacity:0}20%,24%{opacity:1}26%,62%{opacity:0}64%,66%{opacity:1}68%,100%{opacity:0}}
.strike{animation:strike ${LOOP}s steps(1) infinite;opacity:0}
.strike.s2{animation-delay:-${(LOOP * 0.45).toFixed(2)}s}
@keyframes strike{0%,18%{opacity:0}20%,30%{opacity:1}32%,100%{opacity:0}}
.flare{animation:flare ${LOOP / 2}s ease-in-out infinite}
@keyframes flare{0%,100%{transform:scale(.85,.8);opacity:.75}50%{transform:scale(1.1,1.25);opacity:1}}
.ring{animation:ring ${LOOP / 2}s ease-out infinite;transform-origin:${cx}px 222px;opacity:0}
.ring.r2{animation-delay:-${LOOP / 4}s}
@keyframes ring{0%{transform:scale(.4);opacity:1}100%{transform:scale(2.2);opacity:0}}
.spin{animation:spin ${LOOP * 2}s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.frost{animation:frost ${LOOP}s linear infinite;transform-origin:${cx}px 140px}
@keyframes frost{0%{transform:rotate(0) scale(.96);opacity:.5}50%{transform:rotate(30deg) scale(1.04);opacity:1}100%{transform:rotate(60deg) scale(.96);opacity:.5}}
.gust{animation:gust ${LOOP / 2}s linear infinite}
@keyframes gust{0%{transform:translateX(-30px);opacity:0}30%{opacity:1}100%{transform:translateX(30px);opacity:0}}
.fan{animation:fan ${LOOP / 2}s ease-in-out infinite}
@keyframes fan{0%,100%{transform:scale(.9);opacity:.7}50%{transform:scale(1.08);opacity:1}}
.rgb{animation:rgb ${LOOP / 3}s steps(1) infinite}
@keyframes rgb{0%{transform:translate(0,0)}30%{transform:translate(-3px,1px)}60%{transform:translate(3px,-1px)}}
.glitch .body{animation-name:jump}
.gl-r,.gl-c{mix-blend-mode:screen;opacity:0;animation:glc ${LOOP / 2}s steps(1) infinite}
.gl-c{animation-delay:-${LOOP / 5}s}
@keyframes glc{0%,60%{opacity:0;transform:translate(0,0)}62%{opacity:.7;transform:translate(-6px,0)}68%{opacity:.7;transform:translate(5px,2px)}74%,100%{opacity:0}}
.ghost-a{animation:ghosta ${LOOP}s ease-in-out infinite}
@keyframes ghosta{0%,100%{opacity:1}40%{opacity:.35}60%{opacity:1}}
.echo{opacity:0;animation:echo ${LOOP}s ease-out infinite}
.echo.e2{animation-delay:-${LOOP / 3}s}
@keyframes echo{0%{opacity:.45;transform:translate(0,0)}100%{opacity:0;transform:translate(0,-30px) scale(1.1)}}
.float{animation:float ${LOOP}s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
.crown{animation:crownb ${LOOP}s ease-in-out infinite}
@keyframes crownb{0%,100%{transform:translateY(0) rotate(0)}25%{transform:translateY(-12px) rotate(-4deg)}50%{transform:translateY(-10px) rotate(0)}75%{transform:translateY(-12px) rotate(4deg)}}
.halo{animation:spin ${LOOP * 3}s linear infinite}
.aura{animation:aura ${LOOP}s ease-in-out infinite}
@keyframes aura{0%,100%{opacity:.1}50%{opacity:.26}}
.rain{animation:rain ${LOOP}s linear infinite;opacity:0}
@keyframes rain{0%{transform:translate(0,0) rotate(0);opacity:0}10%{opacity:1}85%{opacity:1}100%{transform:translate(var(--sway),calc(var(--h) * -1)) rotate(360deg);opacity:0}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.fly,.zing,.pop,.rise,.tear,.twinkle,.echo,.gl-r,.gl-c,.flash,.strike,.ring,.rain{opacity:0!important}}
${extraCss}`;
  const bodyInner = `${base.body}${patch(c)}<g class="face">${face}</g>`;
  let bodyBlock = `<g class="body ${bodyCls}${ghost ? " ghost-a" : ""}">${bodyInner}</g>`;
  if (glitch && emote === "hype") {
    bodyBlock = `<g class="body ${bodyCls}"><g class="gl-r" style="filter:url(#tint-r)">${bodyInner}</g><g class="gl-c" style="filter:url(#tint-c)">${bodyInner}</g>${bodyInner}</g>`;
  }
  if (ghost && emote === "hype") {
    bodyBlock = `<g class="echo">${base.body}</g><g class="echo e2">${base.body}</g>` + bodyBlock;
  }
  const tints = glitch ? `<filter id="tint-r"><feColorMatrix type="matrix" values="1 0 0 0 .3  0 0 0 0 0  0 0 .6 0 .2  0 0 0 1 0"/></filter><filter id="tint-c"><feColorMatrix type="matrix" values="0 0 0 0 0  0 1 0 0 .3  0 0 1 0 .3  0 0 0 1 0"/></filter>` : "";
  const clip = `<clipPath id="emote-clip"><circle cx="128" cy="128" r="128"/></clipPath>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="${c.name} ${(EMOTES.find((e) => e.id === emote) || { name: "Happy" }).name}"><style>${css.replace(/\n+/g, "\n")}</style>
<defs>${base.defs}${clip}${tints}</defs>
<g clip-path="url(#emote-clip)">${base.bg}
${back}
${bodyBlock}
${front}
</g></svg>`;
}

import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
let n = 0;
for (const c of CHARACTERS) {
  if (only.length && !only.includes(c.id)) continue;
  for (const e of EMOTES) {
    writeFileSync(join(OUT, `${c.id}-${e.id}.svg`), emoteSvg(c, e.id));
    n++;
  }
}
console.log(`wrote ${n} emotes to ${OUT}`);
}
export { emoteSvg };
