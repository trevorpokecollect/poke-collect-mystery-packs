// Builds the Daily Spin mascot art for the Rewards page from the Latch & the BitBots spec (characters.mjs).
//   node scripts/site/emotes/make-spin-art.mjs
// Writes public/site/assets/cardbit-spin-<tier>-happy.svg: a self-contained animated SVG (CSS keyframes only)
// of the tier's character looking happy, with a clean still pose under prefers-reduced-motion.
// and cardbit-spin-<tier>-still.svg: the starter icon's own face, centered the same way, with no motion.
// Locked tiers show the still, so the animation
// only appears once a spin is unlocked.
import { writeFileSync } from "node:fs";
import { CHARACTERS } from "./characters.mjs";
import { emoteSvg } from "./make-emotes.mjs";

// Keep in sync with SPIN_TIERS in app/lib/cardbit-levels.ts.
export const SPIN_MASCOTS = { basic: "mossbit", bronze: "blazebit", silver: "cryobyte", gold: "latch-gold", cobalt: "wyrmware", holo: "latch-holo" };

// Visible center of each character's body in the 256 icon (measured from a body-only render, glow included)
// and the scale that fits its larger side to about 150px, so every character sits centered in its circle.
const FIT_SIZE = 150;
const BODY_BOX = { // [x0, y0, x1, y1]
  mossbit: [60, 51, 204, 225], blazebit: [62, 52, 202, 225], cryobyte: [60, 55, 204, 225],
  "latch-gold": [42, 44, 214, 224], wyrmware: [31, 28, 233, 227], "latch-holo": [42, 44, 214, 224],
};
const fitFor = (id) => {
  const [x0, y0, x1, y1] = BODY_BOX[id];
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s: +Math.min(1, FIT_SIZE / Math.max(x1 - x0, y1 - y0)).toFixed(3) };
};

for (const [tier, id] of Object.entries(SPIN_MASCOTS)) {
  const c = CHARACTERS.find((x) => x.id === id);
  writeFileSync(`public/site/assets/cardbit-spin-${tier}-happy.svg`, emoteSvg(c, "happy", fitFor(id)));
  writeFileSync(`public/site/assets/cardbit-spin-${tier}-still.svg`, emoteSvg(c, "still", fitFor(id)));
}
console.log("wrote", Object.keys(SPIN_MASCOTS).length, "spin mascots");
