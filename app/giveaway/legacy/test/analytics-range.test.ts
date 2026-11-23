import { describe, expect, it } from "vitest";
import { resolveRange } from "../app/lib/analytics-range";

const tz = "America/New_York";
const now = new Date("2026-10-13T03:00:00Z"); // 11pm ET Oct 12, after the 9pm draw
const range = (q: string, drawTime: string | null = "21:00") =>
  resolveRange(new URLSearchParams(q), { timeZone: tz, drawTime, now });

describe("resolveRange", () => {
  it("defaults a daily giveaway to the current draw", () => {
    const r = range("");
    expect(r.preset).toBe("draw");
    expect(r.draw).toBe("2026-10-13");
    expect(r.start?.toISOString()).toBe("2026-10-13T01:00:00.000Z");
    expect(r.end?.toISOString()).toBe("2026-10-14T01:00:00.000Z");
  });

  it("picks an earlier draw by its date", () => {
    const r = range("range=draw&draw=2026-10-12");
    expect(r.start?.toISOString()).toBe("2026-10-12T01:00:00.000Z");
    expect(r.end?.toISOString()).toBe("2026-10-13T01:00:00.000Z");
  });

  it("defaults other giveaways to all time", () => {
    expect(range("", null)).toMatchObject({ preset: "all", start: null });
    expect(range("range=draw", null).preset).toBe("all");
  });

  it("uses whole local days for date ranges", () => {
    const y = range("range=yesterday");
    expect([y.from, y.to]).toEqual(["2026-10-11", "2026-10-11"]);
    expect(y.start?.toISOString()).toBe("2026-10-11T04:00:00.000Z");
    expect(y.end?.toISOString()).toBe("2026-10-12T04:00:00.000Z");
    expect(range("range=7d").from).toBe("2026-10-06");
    expect(range("range=month").from).toBe("2026-10-01");
  });

  it("orders custom dates and falls back to today", () => {
    const r = range("range=custom&from=2026-10-10&to=2026-10-01");
    expect([r.from, r.to]).toEqual(["2026-10-01", "2026-10-10"]);
    expect(range("range=custom&from=bad").from).toBe("2026-10-12");
  });
});
