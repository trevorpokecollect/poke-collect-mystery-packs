import { addDays, periodFor, periodForKey } from "./daily";
import { parseLocalDateTime } from "./time";

// Which slice of time the analytics page shows: one daily draw (previous 9pm to 9pm),
// a range of calendar days in the giveaway's timezone, or everything.

export type RangePreset =
  "draw" | "today" | "yesterday" | "7d" | "30d" | "month" | "custom" | "all";

export interface AnalyticsRange {
  preset: RangePreset;
  /** Daily draw key (YYYY-MM-DD of the draw) when preset is "draw". */
  draw: string | null;
  /** Inclusive local dates for day ranges. */
  from: string | null;
  to: string | null;
  /** The half-open window [start, end); null for all time. */
  start: Date | null;
  end: Date | null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const localDay = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const midnight = (ymd: string, timeZone: string) =>
  parseLocalDateTime(`${ymd}T00:00`, timeZone) as Date;

/**
 * Reads ?range=…&draw=…&from=…&to=… into a window. Daily giveaways default to the
 * current draw, others to all time.
 */
export function resolveRange(
  params: URLSearchParams,
  opts: { timeZone: string; drawTime: string | null; now?: Date },
): AnalyticsRange {
  const now = opts.now ?? new Date();
  const { timeZone, drawTime } = opts;
  const presets: RangePreset[] = [
    "draw",
    "today",
    "yesterday",
    "7d",
    "30d",
    "month",
    "custom",
    "all",
  ];
  const asked = params.get("range") as RangePreset | null;
  let preset: RangePreset =
    asked && presets.includes(asked) ? asked : drawTime ? "draw" : "all";
  if (preset === "draw" && !drawTime) preset = "all";

  if (preset === "draw" && drawTime) {
    const key = params.get("draw");
    const period =
      key && YMD.test(key)
        ? periodForKey(key, timeZone, drawTime)
        : periodFor(now, timeZone, drawTime);
    return {
      preset,
      draw: period.key,
      from: null,
      to: null,
      start: period.opensAt,
      end: period.drawAt,
    };
  }
  if (preset === "all")
    return { preset, draw: null, from: null, to: null, start: null, end: null };

  const today = localDay(now, timeZone);
  let from = today;
  let to = today;
  if (preset === "yesterday") from = to = addDays(today, -1);
  else if (preset === "7d") from = addDays(today, -6);
  else if (preset === "30d") from = addDays(today, -29);
  else if (preset === "month") from = `${today.slice(0, 8)}01`;
  else if (preset === "custom") {
    const f = params.get("from") ?? "";
    const t = params.get("to") ?? "";
    from = YMD.test(f) ? f : today;
    to = YMD.test(t) ? t : from;
    if (to < from) [from, to] = [to, from];
  }
  return {
    preset,
    draw: null,
    from,
    to,
    start: midnight(from, timeZone),
    end: midnight(addDays(to, 1), timeZone),
  };
}
