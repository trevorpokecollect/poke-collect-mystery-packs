// Pack Pass opening cosmetics (site only; Trevor approved the mockup Nov 25 2026, 11:26 PM CT).
// - Card sleeves: cover the not-yet-printed card in the member's own Signal Decode openings and the empty
//   result slots, like a matte sleeve on a real card. Pro and Ultimate get 4; Ultimate adds Gold Legendary.
// - Reveal effect: a burst in a Latch & Friends character's element when each card is decoded. It plays behind
//   and around the card. Default is the character of the member's icon; "off" turns it off.
// Looks only: never changes what is pulled, and nobody else's openings or the live pulls feed change.
// Art: scripts/site/emotes/make-sleeves.mjs -> public/site/img/pass/sleeves/.
import { ICONS } from "../../lib/cardbit-levels";
import { passIcon } from "./pass-icons";

export const PASS_SLEEVES = [
  { id: "neon", name: "Neon", ultimate: false },
  { id: "holo", name: "Holo", ultimate: false },
  { id: "midnight", name: "Midnight", ultimate: false },
  { id: "circuit", name: "Pro Circuit", ultimate: false },
  { id: "gold", name: "Gold Legendary", ultimate: true },
] as const;
const SLEEVE = new Map<string, (typeof PASS_SLEEVES)[number]>(PASS_SLEEVES.map((s) => [s.id, s]));
export const sleeveUrl = (id: string) => `/site/img/pass/sleeves/${id}.svg`;

// Element and colors per character, matching scripts/site/emotes/characters.mjs (rim, accent, pop).
export const REVEAL_FX: Record<string, { element: string; colors: [string, string, string] }> = {
  latch: { element: "card", colors: ["#2EE6F0", "#2EE6F0", "#FFFFFF"] },
  "latch-gold": { element: "gold", colors: ["#FFC94D", "#FFC94D", "#FFF4C9"] },
  "latch-holo": { element: "holo", colors: ["#B98CFF", "#FF6FD8", "#7DF3EA"] },
  blazebit: { element: "fire", colors: ["#FF7A3D", "#FFB23D", "#FFE07A"] },
  driplink: { element: "water", colors: ["#3FA9FF", "#7FD3FF", "#E2F6FF"] },
  mossbit: { element: "grass", colors: ["#4BE07A", "#9BFF8A", "#FFB65C"] },
  zappix: { element: "electric", colors: ["#FFC93D", "#FFE14D", "#FFFFFF"] },
  cryobyte: { element: "ice", colors: ["#8FE3FF", "#CFF6FF", "#FFFFFF"] },
  glitchog: { element: "crystal", colors: ["#B26BFF", "#FF4DD2", "#4DE8FF"] },
  phantab: { element: "ghost", colors: ["#C7B4FF", "#E3D8FF", "#FFFFFF"] },
  nimbyte: { element: "wind", colors: ["#6FD3FF", "#BFF0FF", "#FFFFFF"] },
  wyrmware: { element: "dragon", colors: ["#FF4D6D", "#FF8A5C", "#FFD24D"] },
};

const proUp = (tier: string | null | undefined) => tier === "pro" || tier === "ultimate";
export const isSleeveId = (id: unknown): id is string => typeof id === "string" && SLEEVE.has(id);
export const sleeveAllowed = (id: unknown, tier: string | null | undefined) =>
  isSleeveId(id) && proUp(tier) && (!SLEEVE.get(id)!.ultimate || tier === "ultimate");
export const isRevealChoice = (v: unknown): v is string => v === "off" || (typeof v === "string" && v in REVEAL_FX);

/** The character a member's icon belongs to (regular icon or Pass emote), if any. */
function iconCharacter(iconId: string | null | undefined) {
  if (!iconId) return null;
  const p = passIcon(iconId);
  const id = p ? p.character : iconId;
  return id in REVEAL_FX ? id : null;
}

type Saved = { sleeveId?: string | null; revealFx?: string | null; iconId?: string | null };

/** What the opening should show for this member right now. Everything falls away the moment perks end. */
export function openingStyle(saved: Saved | null | undefined, tier: string | null | undefined) {
  if (!proUp(tier)) return { sleeve: null, reveal: null };
  const sleeve = saved?.sleeveId && sleeveAllowed(saved.sleeveId, tier) ? sleeveUrl(saved.sleeveId) : null;
  const pick = saved?.revealFx === "off" ? null : saved?.revealFx && saved.revealFx in REVEAL_FX ? saved.revealFx : iconCharacter(saved?.iconId);
  return { sleeve, reveal: pick ? { character: pick, ...REVEAL_FX[pick] } : null };
}

/** "My Opening Style" picker data for the Rewards page. */
export function stylePicker(saved: Saved | null | undefined, tier: string | null | undefined) {
  const auto = iconCharacter(saved?.iconId);
  return {
    unlocked: proUp(tier),
    sleeve: saved?.sleeveId && sleeveAllowed(saved.sleeveId, tier) ? saved.sleeveId : null,
    reveal: saved?.revealFx === "off" ? "off" : saved?.revealFx && saved.revealFx in REVEAL_FX ? saved.revealFx : null,
    autoReveal: auto,
    sleeves: PASS_SLEEVES.map((s) => ({ id: s.id, name: s.name, ultimate: s.ultimate, url: sleeveUrl(s.id), unlocked: sleeveAllowed(s.id, tier) })),
    characters: ICONS.filter((i) => i.id in REVEAL_FX).map((i) => ({ id: i.id, name: i.name, element: REVEAL_FX[i.id].element })),
  };
}
