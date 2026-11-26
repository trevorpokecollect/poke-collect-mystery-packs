// Builds the Daily Spin mascot art for the Rewards page from the Latch & Friends spec (characters.mjs).
//   node scripts/site/emotes/make-spin-art.mjs
// Writes public/site/assets/cardbit-spin-<tier>-happy.svg: a self-contained animated SVG (CSS keyframes only)
// of the tier's character looking happy, with a clean still pose under prefers-reduced-motion.
// Locked tiers show the character's static starter icon instead (cardbit-icon-<id>.*), so the animation
// only appears once a spin is unlocked.
import { writeFileSync } from "node:fs";
import { CHARACTERS } from "./characters.mjs";
import { emoteSvg } from "./make-emotes.mjs";

// Keep in sync with SPIN_TIERS in app/lib/cardbit-levels.ts.
export const SPIN_MASCOTS = { basic: "mossbit", bronze: "blazebit", silver: "cryobyte", gold: "latch-gold", cobalt: "wyrmware", holo: "latch-holo" };

for (const [tier, id] of Object.entries(SPIN_MASCOTS)) {
  const c = CHARACTERS.find((x) => x.id === id);
  writeFileSync(`public/site/assets/cardbit-spin-${tier}-happy.svg`, emoteSvg(c, "happy"));
}
console.log("wrote", Object.keys(SPIN_MASCOTS).length, "spin mascots");
