import { addDays, periodFor } from "./daily";
import { parseLocalDateTime } from "./time";

// Pure helpers for Daily Tasks: tasks (action config `daily: true`) that unlock once every
// one-time follow task is done and can be claimed again each task day. Some run only in a
// weekly window (e.g. Fridays 5–8pm Central while the Whatnot show is live).
// The server uses these to decide what may be claimed; the widget only displays the result.

export const TASK_TIMEZONE = "America/Chicago";

/** When daily tasks reset: at the daily draw (once per draw), or at midnight Central. */
export type ResetMode = "draw" | "midnight";

export interface TaskSchedule {
  /** Days of the week, 0 = Sunday … 6 = Saturday, in America/Chicago. */
  days: number[];
  /** "HH:mm" Central. */
  start: string;
  /** "HH:mm" Central, after start (windows don't cross midnight). */
  end: string;
}

export interface TaskConfig {
  url?: string;
  urls?: string[];
  daily?: boolean;
  confirm?: string;
  seconds?: number;
  schedule?: TaskSchedule;
  live?: boolean;
  paused?: boolean;
  latestInstagram?: boolean;
  verifyBuylist?: boolean;
  verifyMarketListing?: boolean;
  archived?: boolean;
}

interface ActionLike {
  id: string;
  type: string;
  mandatory: boolean;
  config: unknown;
}

const cfg = (c: unknown): TaskConfig =>
  c && typeof c === "object" && !Array.isArray(c) ? (c as TaskConfig) : {};

export const isDailyTask = (a: { config: unknown }) =>
  cfg(a.config).daily === true;

/**
 * Tasks that unlock Daily Tasks: every live one-time follow (e.g. Whatnot, Discord, Facebook,
 * Instagram) plus anything required. Text alerts are never on this list: SMS stays optional.
 */
export function unlockTasks<T extends ActionLike>(actions: T[]) {
  return actions.filter((a) => {
    const c = cfg(a.config);
    if (c.archived || c.daily) return false;
    if (["SIGNUP", "REFERRAL", "ALTERNATE_ENTRY", "SMS_OPTIN"].includes(a.type))
      return false;
    return a.type === "SOCIAL_FOLLOW" || a.mandatory;
  });
}

export function dailyUnlocked<T extends ActionLike>(
  actions: T[],
  doneIds: Set<string | null>,
) {
  const need = unlockTasks(actions);
  return { unlocked: need.every((a) => doneIds.has(a.id)), need };
}

function localParts(date: Date, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    hm: `${p.hour}:${p.minute}`,
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      p.weekday,
    ),
  };
}

const at = (ymd: string, hm: string, tz = TASK_TIMEZONE) =>
  parseLocalDateTime(`${ymd}T${hm}`, tz) as Date;

export interface TaskDay {
  /** Ends every daily task's dedupe key, so a task pays once per task day. */
  key: string;
  /** When this task day began (the previous draw, or midnight Central). */
  startsAt: Date;
  resetsAt: Date;
}

/**
 * The task day containing `now`. "draw" follows the daily draw (keys match the draw day, so
 * claims made before this feature still count as today's); "midnight" is the Central date.
 */
export function taskDay(
  now: Date,
  mode: ResetMode,
  draw: { timeZone: string; drawTime: string } | null,
): TaskDay {
  if (mode === "draw" && draw) {
    const p = periodFor(now, draw.timeZone, draw.drawTime);
    return { key: p.key, startsAt: p.opensAt, resetsAt: p.drawAt };
  }
  const { ymd } = localParts(now, TASK_TIMEZONE);
  return {
    key: `ct-${ymd}`,
    startsAt: at(ymd, "00:00"),
    resetsAt: at(addDays(ymd, 1), "00:00"),
  };
}

export interface Window {
  key: string;
  opensAt: Date;
  closesAt: Date;
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const validSchedule = (s: TaskSchedule | undefined): s is TaskSchedule =>
  !!s &&
  Array.isArray(s.days) &&
  s.days.length > 0 &&
  s.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
  HM.test(s.start) &&
  HM.test(s.end) &&
  s.start < s.end;

/** The scheduled window open at `now`, or null. */
export function openWindow(s: TaskSchedule, now: Date): Window | null {
  if (!validSchedule(s)) return null;
  const { ymd, weekday } = localParts(now, TASK_TIMEZONE);
  if (!s.days.includes(weekday)) return null;
  const opensAt = at(ymd, s.start);
  const closesAt = at(ymd, s.end);
  if (now < opensAt || now >= closesAt) return null;
  return { key: `win-${ymd}`, opensAt, closesAt };
}

/** The next window that opens after `now` (within two weeks). */
export function nextWindow(s: TaskSchedule, now: Date): Window | null {
  if (!validSchedule(s)) return null;
  const { ymd } = localParts(now, TASK_TIMEZONE);
  for (let i = 0; i <= 14; i++) {
    const day = addDays(ymd, i);
    const opensAt = at(day, s.start);
    if (opensAt <= now) continue;
    if (!s.days.includes(localParts(opensAt, TASK_TIMEZONE).weekday)) continue;
    return { key: `win-${day}`, opensAt, closesAt: at(day, s.end) };
  }
  return null;
}

/** Today's link for a task that rotates through several (one per task day, in order). */
export function rotatedUrl(c: TaskConfig, dayKey: string) {
  const list = [c.url, ...(c.urls ?? [])].filter(
    (u, i, all): u is string => !!u && all.indexOf(u) === i,
  );
  if (list.length <= 1) return list[0] ?? null;
  const ymd = dayKey.replace(/^ct-/, "");
  const n = Math.floor(Date.parse(`${ymd}T12:00:00Z`) / 86_400_000);
  return list[((n % list.length) + list.length) % list.length];
}

export type TaskStatus =
  | { claimable: true; dedupeSuffix: string }
  | { claimable: false; reason: string };

/** Whether a daily task can be claimed right now, and the dedupe suffix to claim it with. */
export function taskStatus(
  c: TaskConfig,
  day: TaskDay,
  unlocked: boolean,
  now: Date,
): TaskStatus {
  if (!unlocked)
    return {
      claimable: false,
      reason: "Complete the social tasks first to unlock daily tasks.",
    };
  if (c.schedule) {
    if (c.paused)
      return { claimable: false, reason: "This one isn't running right now." };
    const w = openWindow(c.schedule, now);
    if (!w)
      return {
        claimable: false,
        reason: "This one is only open during the scheduled time.",
      };
    return { claimable: true, dedupeSuffix: `:${w.key}` };
  }
  return { claimable: true, dedupeSuffix: `:${day.key}` };
}
