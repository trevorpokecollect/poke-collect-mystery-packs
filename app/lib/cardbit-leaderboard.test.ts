import { describe, expect, it } from "vitest";
import { weekWindow } from "./cardbit-leaderboard.server";

describe("Weekly leaderboard window", () => {
  it("runs Monday to Monday, Central time", () => {
    // Tuesday Nov 24 2026, 12:30 PM Central (CST, UTC-6)
    const w = weekWindow(new Date("2026-11-24T18:30:00Z"));
    expect(w.start.toISOString()).toBe("2026-11-23T06:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-30T06:00:00.000Z");
    // Sunday 11:59 PM Central still belongs to that week
    expect(weekWindow(new Date("2026-11-30T05:59:00Z")).start.toISOString()).toBe("2026-11-23T06:00:00.000Z");
    // Summer time (CDT, UTC-5)
    expect(weekWindow(new Date("2026-07-15T17:00:00Z")).start.toISOString()).toBe("2026-07-13T05:00:00.000Z");
  });
});
