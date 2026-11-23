import { periodFor, periodForKey } from "./daily";

// Which entries the "Entries By Method" and "New Sign-Ups" sections count on a daily
// giveaway: the current draw (default), one past draw, or all time.

export type MethodPeriod = "today" | "draw" | "all";

export interface MethodWindow {
  period: MethodPeriod;
  /** The past draw's key (YYYY-MM-DD) when period is "draw". */
  draw: string | null;
  since?: Date;
  until?: Date;
}

/**
 * Reads the `methods` / `draw` query params. A past draw counts entries in its own
 * [opensAt, drawAt) window; an unknown draw falls back to the most recent past one.
 */
export function methodWindow(opts: {
  daily: boolean;
  methods: string | null;
  draw: string | null;
  pastDraws: string[];
  now: Date;
  timeZone: string;
  drawTime: string;
}): MethodWindow {
  if (!opts.daily || opts.methods === "all")
    return { period: "all", draw: null };
  if (opts.methods === "draw" && opts.pastDraws.length) {
    const key =
      opts.draw && opts.pastDraws.includes(opts.draw)
        ? opts.draw
        : opts.pastDraws[0];
    const p = periodForKey(key, opts.timeZone, opts.drawTime);
    return { period: "draw", draw: key, since: p.opensAt, until: p.drawAt };
  }
  const p = periodFor(opts.now, opts.timeZone, opts.drawTime);
  return { period: "today", draw: null, since: p.opensAt };
}
