// Follow-button click counting (the "Follow On Whatnot" stand-in for Whatnot sign-ups in
// Trevor's ad report). Pure helpers; the database side is follow-clicks.server.ts.

/** Clicks are bucketed by calendar day in Central Time (Trevor's report runs on it). */
export const FOLLOW_CLICK_TZ = "America/Chicago";

export const FOLLOW_PLATFORMS = [
  "whatnot",
  "discord",
  "youtube",
  "instagram",
  "facebook",
  "tiktok",
  "x",
  "other",
] as const;
export type FollowPlatform = (typeof FOLLOW_PLATFORMS)[number];

// Same table as platformOf() in extensions/giveaway-widget/assets/giveaway.js.
const HOSTS: [FollowPlatform, RegExp][] = [
  ["whatnot", /(^|\.)whatnot\.com$/],
  ["discord", /(^|\.)discord\.(gg|com)$/],
  ["youtube", /(^|\.)(youtube\.com|youtu\.be)$/],
  ["instagram", /(^|\.)instagram\.com$/],
  ["facebook", /(^|\.)(facebook\.com|fb\.com)$/],
  ["tiktok", /(^|\.)tiktok\.com$/],
  ["x", /(^|\.)(x\.com|twitter\.com)$/],
];

/** The platform a follow/visit action points at, or null if it isn't a follow button. */
export function platformOfAction(action: {
  type: string;
  config?: unknown;
}): FollowPlatform | null {
  if (action.type !== "SOCIAL_FOLLOW" && action.type !== "VISIT_URL")
    return null;
  const cfg = (action.config ?? {}) as { url?: unknown };
  const fallback = action.type === "SOCIAL_FOLLOW" ? "other" : null;
  let host: string;
  try {
    host = new URL(String(cfg.url ?? "")).hostname.toLowerCase();
  } catch {
    return fallback;
  }
  return HOSTS.find(([, re]) => re.test(host))?.[0] ?? fallback;
}

/** YYYY-MM-DD for `at` in Central Time. */
export function centralDate(at: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FOLLOW_CLICK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** The `days` Central Time dates ending today, oldest first. */
export function recentDates(days: number, now: Date = new Date()) {
  const today = centralDate(now);
  const [y, m, d] = today.split("-").map(Number);
  return Array.from({ length: days }, (_, i) =>
    new Date(Date.UTC(y, m - 1, d - (days - 1 - i), 12))
      .toISOString()
      .slice(0, 10),
  );
}

/** ?days= for the stats endpoint: 1 to 366, default 14. */
export function parseDays(raw: string | null) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return 14;
  return Math.min(n, 366);
}

/**
 * One row per date (newest first) with a click count per platform, for the admin table.
 * Whatnot is always a column and comes first; other platforms appear once they have clicks.
 */
export function followClickTable(
  rows: { date: string; platform: string; clicks: number }[],
  dates: string[],
) {
  const seen = new Set(rows.map((r) => r.platform));
  const platforms = FOLLOW_PLATFORMS.filter(
    (p) => p === "whatnot" || seen.has(p),
  );
  const byKey = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.date}|${r.platform}`;
    byKey.set(k, (byKey.get(k) ?? 0) + r.clicks);
  }
  const days = [...dates].reverse().map((date) => ({
    date,
    counts: platforms.map((p) => byKey.get(`${date}|${p}`) ?? 0),
  }));
  const totals = platforms.map((_, i) =>
    days.reduce((sum, d) => sum + d.counts[i], 0),
  );
  return { platforms, days, totals };
}

export const PLATFORM_LABELS: Record<FollowPlatform, string> = {
  whatnot: "Whatnot",
  discord: "Discord",
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  x: "X",
  other: "Other",
};
