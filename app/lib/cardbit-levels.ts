/**
 * Cardbit levels, XP and Latch & Friends icons. Pure rules shared by the server and tests.
 * XP never has cash value and never converts to Cardbits.
 */

/** XP earned per action. 10 XP per US$1 of Cardbits spent (100 Cardbits = $1). */
export const XP_RULES = {
  perCardbitsSpent: 10 / 100,
  perPackOpened: 25,
  dailyCheckIn: 50,
} as const;

export const MAX_LEVEL = 50;

/** Total XP needed to reach a level. Level 1 starts at 0. */
export function xpForLevel(level: number) {
  const n = Math.min(Math.max(Math.floor(level), 1), MAX_LEVEL) - 1;
  return 50 * n * n + 100 * n;
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
  return Math.floor(cardbitsSpent * XP_RULES.perCardbitsSpent) + XP_RULES.perPackOpened * packs;
}

export type SpinnerTier = { id: string; name: string; minLevel: number };
/** Daily Spinner tiers by level. Prize tables live in the Daily Spin pool, not here. */
export const SPINNER_TIERS: SpinnerTier[] = [
  { id: "basic", name: "Basic Spinner", minLevel: 1 },
  { id: "silver", name: "Silver Spinner", minLevel: 10 },
  { id: "gold", name: "Gold Spinner", minLevel: 25 },
  { id: "cobalt", name: "Cobalt Spinner", minLevel: 40 },
];
export const spinnerFor = (level: number) =>
  [...SPINNER_TIERS].reverse().find((t) => level >= t.minLevel)!;

export type Icon = { id: string; name: string; minLevel: number; animated?: boolean; subscription?: boolean };
/** Latch & Friends. Basic static icons are open at level 1; the rest unlock by level. */
export const ICONS: Icon[] = [
  { id: "latch", name: "Latch", minLevel: 1 },
  { id: "smorsel", name: "Smorsel", minLevel: 1 },
  { id: "tidepip", name: "Tidepip", minLevel: 1 },
  { id: "mossbit", name: "Mossbit", minLevel: 1 },
  { id: "zappix", name: "Zappix", minLevel: 5 },
  { id: "frostnib", name: "Frostnib", minLevel: 5 },
  { id: "shardle", name: "Shardle", minLevel: 10 },
  { id: "phantab", name: "Phantab", minLevel: 10 },
  { id: "skytab", name: "Skytab", minLevel: 15 },
  { id: "foldrake", name: "Foldrake", minLevel: 15 },
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
