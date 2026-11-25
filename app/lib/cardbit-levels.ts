/**
 * Cardbit levels, XP and Latch & Friends icons. Pure rules shared by the server and tests.
 * XP never has cash value and never converts to Cardbits.
 */

/**
 * XP earned per action. 2 XP per US$1 of Cardbits spent on a paid pack (100 Cardbits = $1), no flat
 * amount per pack, so recycled buyback Cardbits can't farm levels cheaply. Check-ins stay small.
 */
export const XP_RULES = {
  perCardbitsSpent: 2 / 100,
  perPackOpened: 0,
  dailyCheckIn: 5,
} as const;

export const MAX_LEVEL = 50;

/** Total XP needed to reach a level: n³ + 9n² + 10n with n = level - 1. Level 1 starts at 0, Level 2 is 20, Level 50 is 139,748. */
export function xpForLevel(level: number) {
  const n = Math.min(Math.max(Math.floor(level), 1), MAX_LEVEL) - 1;
  return n * n * n + 9 * n * n + 10 * n;
}

export function levelForXp(xp: number) {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

export function levelProgress(xp: number) {
  const safe = Math.max(0, Math.floor(xp));
  const level = levelForXp(safe);
  const floor = xpForLevel(level);
  const next = level < MAX_LEVEL ? xpForLevel(level + 1) : null;
  return {
    xp: safe,
    level,
    levelXp: safe - floor,
    nextLevelXp: next === null ? null : next - floor,
    toNext: next === null ? 0 : next - safe,
  };
}

/** XP for one paid pack opening, from the Cardbits actually spent. */
export function packXp(cardbitsSpent: number, packs = 1) {
  if (!Number.isSafeInteger(cardbitsSpent) || cardbitsSpent < 0) return 0;
  return Math.round(cardbitsSpent * XP_RULES.perCardbitsSpent) + XP_RULES.perPackOpened * packs;
}

export type SpinnerTier = { id: string; name: string; minLevel: number };
/** Daily Spinner tiers by level. Prize tables live in the Daily Spin pool, not here. */
/** Every unlocked tier spins once per Cardbit day, so leveling up adds more free spins. */
export const SPINNER_TIERS: SpinnerTier[] = [
  { id: "basic", name: "Basic Spin", minLevel: 1 },
  { id: "bronze", name: "Bronze Spin", minLevel: 5 },
  { id: "silver", name: "Silver Spin", minLevel: 10 },
  { id: "gold", name: "Gold Spin", minLevel: 20 },
  { id: "cobalt", name: "Cobalt Spin", minLevel: 30 },
  { id: "holo", name: "Holo Spin", minLevel: 40 },
];
export const spinnerFor = (level: number) =>
  [...SPINNER_TIERS].reverse().find((t) => level >= t.minLevel)!;
export const unlockedSpinners = (level: number) => SPINNER_TIERS.filter((t) => level >= t.minLevel);

/** Collector ranks shown beside the level number. */
export const RANKS = [
  { minLevel: 1, name: "Rookie" },
  { minLevel: 5, name: "Collector" },
  { minLevel: 10, name: "Curator" },
  { minLevel: 20, name: "Archivist" },
  { minLevel: 30, name: "Vaultkeeper" },
  { minLevel: 40, name: "Legend" },
  { minLevel: 50, name: "Mythic" },
] as const;
export const rankFor = (level: number) => [...RANKS].reverse().find((r) => level >= r.minLevel)!.name;

export type Icon = { id: string; name: string; minLevel: number; animated?: boolean; subscription?: boolean };
/** Latch & Friends. Basic static icons are open at level 1; the rest unlock by level. */
export const ICONS: Icon[] = [
  { id: "latch", name: "Latch", minLevel: 1 },
  { id: "blazebit", name: "Blazebit", minLevel: 1 },
  { id: "driplink", name: "Driplink", minLevel: 1 },
  { id: "mossbit", name: "Mossbit", minLevel: 1 },
  { id: "zappix", name: "Zappix", minLevel: 5 },
  { id: "cryobyte", name: "Cryobyte", minLevel: 5 },
  { id: "glitchog", name: "Glitchog", minLevel: 10 },
  { id: "phantab", name: "Phantab", minLevel: 10 },
  { id: "nimbyte", name: "Nimbyte", minLevel: 15 },
  { id: "wyrmware", name: "Wyrmware", minLevel: 15 },
  { id: "latch-gold", name: "Latch Gold", minLevel: 20 },
  { id: "latch-holo", name: "Latch Holo", minLevel: 30 },
];
export const iconUnlocked = (icon: Icon, level: number) =>
  !icon.subscription && level >= icon.minLevel;

/** Initials avatar colors. Text color keeps contrast on each background. */
export const AVATAR_COLORS = [
  { id: "cobalt", bg: "#4057F5", fg: "#FAF8F3" },
  { id: "apricot", bg: "#FFB65C", fg: "#17213B" },
  { id: "navy", bg: "#17213B", fg: "#FAF8F3" },
  { id: "mint", bg: "#3DD6A3", fg: "#17213B" },
  { id: "berry", bg: "#C2417A", fg: "#FAF8F3" },
  { id: "sky", bg: "#5FC3F2", fg: "#17213B" },
  { id: "violet", bg: "#7A52E0", fg: "#FAF8F3" },
  { id: "ember", bg: "#E8553B", fg: "#FAF8F3" },
] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number]["id"];

/** A stable "random" default color per customer, so it never flickers between visits. */
export function defaultColor(customerId: string): AvatarColor {
  let h = 0;
  for (const ch of customerId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length].id;
}

export function initials(first?: string | null, last?: string | null) {
  const pick = (s?: string | null) => (s || "").trim().charAt(0).toUpperCase();
  return pick(first) + pick(last) || "?";
}

/** The Cardbit day runs midnight to midnight Central time. */
export function cardbitDay(at = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
export function previousDay(day: string) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
