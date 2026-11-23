import { describe, expect, it } from "vitest";
import {
  dailyUnlocked,
  nextWindow,
  openWindow,
  rotatedUrl,
  taskDay,
  taskStatus,
  unlockTasks,
} from "../app/lib/daily-tasks";

const draw = { timeZone: "America/New_York", drawTime: "21:00" };
const friday = { days: [5], start: "17:00", end: "20:00" };
// 2026-10-16 is a Friday. CDT = UTC-5, so 5pm CT = 22:00Z and 8pm CT = 01:00Z next day.
const t = (iso: string) => new Date(iso);

describe("task day", () => {
  it("resets at the daily draw (9pm ET) by default", () => {
    const before = taskDay(t("2026-10-14T00:59:00Z"), "draw", draw);
    const after = taskDay(t("2026-10-14T01:00:00Z"), "draw", draw);
    expect(before.key).toBe("2026-10-13");
    expect(before.resetsAt.toISOString()).toBe("2026-10-14T01:00:00.000Z");
    expect(after.key).toBe("2026-10-14");
  });

  it("resets at midnight Central when asked, or without a daily draw", () => {
    expect(taskDay(t("2026-10-14T04:59:00Z"), "midnight", draw).key).toBe(
      "ct-2026-10-13",
    );
    const next = taskDay(t("2026-10-14T05:00:00Z"), "midnight", draw);
    expect(next.key).toBe("ct-2026-10-14");
    expect(next.resetsAt.toISOString()).toBe("2026-10-15T05:00:00.000Z");
    expect(taskDay(t("2026-10-14T05:00:00Z"), "draw", null).key).toBe(
      "ct-2026-10-14",
    );
  });

  it("handles the DST change (Nov 1 2026: midnight CT moves from 05:00Z to 06:00Z)", () => {
    const sat = taskDay(t("2026-11-01T04:00:00Z"), "midnight", null);
    expect(sat.key).toBe("ct-2026-10-31");
    expect(sat.resetsAt.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    const sun = taskDay(t("2026-11-01T12:00:00Z"), "midnight", null);
    expect(sun.resetsAt.toISOString()).toBe("2026-11-02T06:00:00.000Z");
    // Draw-day reset follows ET: 9pm EST = 02:00Z after the change.
    expect(
      taskDay(t("2026-11-02T01:30:00Z"), "draw", draw).resetsAt.toISOString(),
    ).toBe("2026-11-02T02:00:00.000Z");
  });
});

describe("Friday live window", () => {
  it("opens at 5:00pm and closes at 8:00pm Central", () => {
    expect(openWindow(friday, t("2026-10-16T21:59:00Z"))).toBeNull();
    const w = openWindow(friday, t("2026-10-16T22:00:00Z"));
    expect(w?.key).toBe("win-2026-10-16");
    expect(openWindow(friday, t("2026-10-17T00:59:00Z"))?.key).toBe(
      "win-2026-10-16",
    );
    expect(openWindow(friday, t("2026-10-17T01:00:00Z"))).toBeNull();
    // Thursday at 6pm CT: closed.
    expect(openWindow(friday, t("2026-10-15T23:00:00Z"))).toBeNull();
  });

  it("uses Central time after DST ends (5pm CST = 23:00Z)", () => {
    expect(openWindow(friday, t("2026-11-06T22:30:00Z"))).toBeNull();
    expect(openWindow(friday, t("2026-11-06T23:00:00Z"))?.key).toBe(
      "win-2026-11-06",
    );
  });

  it("finds the next window", () => {
    const n = nextWindow(friday, t("2026-10-13T15:00:00Z"));
    expect(n?.opensAt.toISOString()).toBe("2026-10-16T22:00:00.000Z");
    // During a window, the next one is a week later.
    expect(
      nextWindow(friday, t("2026-10-16T23:00:00Z"))?.opensAt.toISOString(),
    ).toBe("2026-10-23T22:00:00.000Z");
  });
});

describe("claim status", () => {
  const day = taskDay(t("2026-10-16T23:00:00Z"), "draw", draw);
  it("needs the unlock", () => {
    expect(taskStatus({}, day, false, new Date()).claimable).toBe(false);
  });
  it("uses the task day for plain daily tasks", () => {
    expect(taskStatus({ daily: true }, day, true, new Date())).toEqual({
      claimable: true,
      dedupeSuffix: ":2026-10-16",
    });
  });
  it("uses the window for scheduled tasks, and respects the off switch", () => {
    const inWindow = t("2026-10-16T23:00:00Z");
    expect(taskStatus({ schedule: friday }, day, true, inWindow)).toEqual({
      claimable: true,
      dedupeSuffix: ":win-2026-10-16",
    });
    expect(
      taskStatus({ schedule: friday, paused: true }, day, true, inWindow)
        .claimable,
    ).toBe(false);
    expect(
      taskStatus({ schedule: friday }, day, true, t("2026-10-17T02:00:00Z"))
        .claimable,
    ).toBe(false);
  });
});

describe("unlock and rotation", () => {
  const actions = [
    { id: "s", type: "SIGNUP", mandatory: true, config: null },
    { id: "w", type: "SOCIAL_FOLLOW", mandatory: true, config: { url: "x" } },
    { id: "d", type: "SOCIAL_FOLLOW", mandatory: false, config: { url: "x" } },
    { id: "sms", type: "SMS_OPTIN", mandatory: false, config: {} },
    {
      id: "old",
      type: "SOCIAL_FOLLOW",
      mandatory: false,
      config: { archived: true },
    },
    { id: "b", type: "VISIT_URL", mandatory: false, config: { daily: true } },
    { id: "r", type: "REFERRAL", mandatory: false, config: {} },
  ];
  it("needs every live follow task, never SMS", () => {
    expect(unlockTasks(actions).map((a) => a.id)).toEqual(["w", "d"]);
    expect(dailyUnlocked(actions, new Set(["w"])).unlocked).toBe(false);
    expect(dailyUnlocked(actions, new Set(["w", "d"])).unlocked).toBe(true);
  });
  it("rotates links by day", () => {
    const c = { url: "https://a", urls: ["https://b", "https://c"] };
    const seen = ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"].map(
      (k) => rotatedUrl(c, k),
    );
    expect(new Set(seen.slice(0, 3)).size).toBe(3);
    expect(seen[3]).toBe(seen[0]);
    expect(rotatedUrl(c, "ct-2026-10-14")).toBe(seen[1]);
    expect(rotatedUrl({ url: "https://a" }, "2026-10-13")).toBe("https://a");
  });
});
