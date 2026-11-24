import { describe, expect, it } from "vitest";
import {
  guardMode,
  holdConfig,
  shipOpensAt,
  statusAllows,
  threeDSecure,
  topupAllowance,
  turnstileActions,
} from "./cardbit-guard";
import { deviceId, keyedHash, turnstileToken, verifyTurnstile } from "./cardbit-guard.server";

const now = new Date("2026-12-01T12:00:00Z");
const hours = (h: number) => new Date(now.getTime() - h * 3_600_000);
const config = holdConfig({} as NodeJS.ProcessEnv);

describe("guard mode", () => {
  it("defaults to log so a deploy refuses nobody", () => {
    expect(guardMode({} as NodeJS.ProcessEnv)).toBe("log");
    expect(guardMode({ CARDBIT_GUARD: "on" } as NodeJS.ProcessEnv)).toBe("on");
    expect(guardMode({ CARDBIT_GUARD: "off" } as NodeJS.ProcessEnv)).toBe("off");
    expect(guardMode({ CARDBIT_GUARD: "yes" } as NodeJS.ProcessEnv)).toBe("log");
  });
  it("reads the Turnstile action list", () => {
    expect(turnstileActions({} as NodeJS.ProcessEnv).has("spin")).toBe(true);
    expect([...turnstileActions({ CARDBIT_TURNSTILE_ACTIONS: "ship, topup" } as NodeJS.ProcessEnv)]).toEqual(["ship", "topup"]);
    expect(turnstileActions({ CARDBIT_TURNSTILE_ACTIONS: "" } as NodeJS.ProcessEnv).size).toBe(0);
  });
});

describe("account status", () => {
  it("review pauses money-out and free rewards but not opening packs", () => {
    expect(statusAllows("review", "ship")).toBe(false);
    expect(statusAllows("review", "buyback")).toBe(false);
    expect(statusAllows("review", "spin")).toBe(false);
    expect(statusAllows("review", "pack")).toBe(true);
    expect(statusAllows("blocked", "pack")).toBe(false);
    expect(statusAllows("trusted", "ship")).toBe(true);
  });
});

describe("shipping hold", () => {
  it("waits 72 hours after sign-up and after each paid top-up", () => {
    expect(shipOpensAt({ accountCreatedAt: hours(10), lastPaidTopupAt: null, status: "ok" }, now, config)).toEqual(
      new Date(hours(10).getTime() + 72 * 3_600_000),
    );
    expect(shipOpensAt({ accountCreatedAt: hours(100), lastPaidTopupAt: hours(1), status: "ok" }, now, config)).toEqual(
      new Date(hours(1).getTime() + 72 * 3_600_000),
    );
    expect(shipOpensAt({ accountCreatedAt: hours(100), lastPaidTopupAt: hours(80), status: "ok" }, now, config)).toBeNull();
  });
  it("trusted accounts skip it", () => {
    expect(shipOpensAt({ accountCreatedAt: hours(1), lastPaidTopupAt: hours(1), status: "trusted" }, now, config)).toBeNull();
  });
});

describe("top-up limits", () => {
  it("caps new accounts at $100 a day and $250 in the first week", () => {
    const base = { accountCreatedAt: hours(24), paidLast24hCents: 0, paidLastWeekCents: 0, status: "ok" as const };
    expect(topupAllowance(base, now, config)).toBe(10_000);
    expect(topupAllowance({ ...base, paidLast24hCents: 5_000, paidLastWeekCents: 5_000 }, now, config)).toBe(5_000);
    expect(topupAllowance({ ...base, paidLastWeekCents: 20_000 }, now, config)).toBe(5_000);
  });
  it("allows $1,000 a day after the first week, nothing while in review", () => {
    const old = { accountCreatedAt: hours(24 * 30), paidLast24hCents: 0, paidLastWeekCents: 0, status: "ok" as const };
    expect(topupAllowance(old, now, config)).toBe(100_000);
    expect(topupAllowance({ ...old, status: "review" }, now, config)).toBe(0);
  });
  it("asks for 3D Secure on new accounts, first top-ups and $100+", () => {
    expect(threeDSecure({ accountCreatedAt: hours(24), paidTopups: 3, cents: 1000 }, now)).toBe("any");
    expect(threeDSecure({ accountCreatedAt: hours(24 * 30), paidTopups: 0, cents: 1000 }, now)).toBe("any");
    expect(threeDSecure({ accountCreatedAt: hours(24 * 30), paidTopups: 2, cents: 10_000 }, now)).toBe("any");
    expect(threeDSecure({ accountCreatedAt: hours(24 * 30), paidTopups: 2, cents: 5_000 }, now)).toBe("automatic");
  });
});

describe("request helpers", () => {
  it("reads the Turnstile token and device id from header or query", () => {
    const r = new Request("https://x/apps/p?cbt=tok&cbd=abcdefghijklmnop");
    expect(turnstileToken(r)).toBe("tok");
    expect(deviceId(r)).toBe("abcdefghijklmnop");
    expect(deviceId(new Request("https://x/?cbd=short"))).toBeNull();
    expect(turnstileToken(new Request("https://x/", { headers: { "x-cardbit-turnstile": "h" } }))).toBe("h");
  });
  it("hashes with a key", () => {
    expect(keyedHash("a", { CARDBIT_GUARD_SECRET: "1" } as NodeJS.ProcessEnv)).not.toBe(
      keyedHash("a", { CARDBIT_GUARD_SECRET: "2" } as NodeJS.ProcessEnv),
    );
  });
  it("verifies Turnstile and checks the hostname", async () => {
    const env = { CARDBIT_TURNSTILE_SECRET_KEY: "s" } as NodeJS.ProcessEnv;
    const reply = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
    expect(await verifyTurnstile("t", {} as NodeJS.ProcessEnv)).toEqual({ ok: true, reason: "not-configured" });
    expect((await verifyTurnstile(null, env)).ok).toBe(false);
    expect((await verifyTurnstile("t", env, reply({ success: true, hostname: "cardbit.com" }))).ok).toBe(true);
    expect((await verifyTurnstile("t", env, reply({ success: true, hostname: "evil.example" }))).ok).toBe(false);
    expect((await verifyTurnstile("t", env, reply({ success: false, "error-codes": ["invalid-input-response"] }))).reason).toBe(
      "invalid-input-response",
    );
  });
});
