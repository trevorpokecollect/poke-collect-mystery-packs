import { describe, expect, it } from "vitest";
import {
  isDisposableEmail,
  looksGenerated,
  normalizeEmail,
} from "../app/lib/bot/email";
import {
  decide,
  DEFAULT_RISK_POLICY,
  scoreSignals,
  turnstileSignal,
} from "../app/lib/bot/risk";
import { verifyTurnstile } from "../app/lib/bot/turnstile.server";
import { subnetOf } from "../app/lib/bot/fingerprint.server";

describe("email hygiene", () => {
  it("collapses gmail dots and plus aliases", () => {
    expect(normalizeEmail("A.S.H+giveaway1@Gmail.com")).toBe("ash@gmail.com");
    expect(normalizeEmail("ash@googlemail.com")).toBe("ash@gmail.com");
    expect(normalizeEmail("misty+x@outlook.com")).toBe("misty@outlook.com");
  });

  it("keeps dots for providers where they matter", () => {
    expect(normalizeEmail("brock.harrison@poke-collect.com")).toBe(
      "brock.harrison@poke-collect.com",
    );
  });

  it("detects disposable domains, including subdomains", () => {
    expect(isDisposableEmail("x@mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@abc.yopmail.com")).toBe(true);
    expect(isDisposableEmail("x@gmail.com")).toBe(false);
    expect(isDisposableEmail("x@custom-burner.io", ["custom-burner.io"])).toBe(
      true,
    );
  });

  it("flags generated-looking addresses", () => {
    expect(looksGenerated("user84729163@gmail.com")).toBe(true);
    expect(looksGenerated("xkcdqwrtz@gmail.com")).toBe(true);
    expect(looksGenerated("pikachu.fan@gmail.com")).toBe(false);
  });
});

describe("risk scoring", () => {
  it("dedupes signals and caps at 100", () => {
    const r = scoreSignals([
      { code: "turnstile_failed" },
      { code: "turnstile_failed" },
      { code: "disposable_email" },
    ]);
    expect(r.signals).toHaveLength(2);
    expect(r.score).toBe(100);
  });

  it("only asks for an email code when the hidden field is the sole signal", () => {
    const r = scoreSignals([{ code: "honeypot" }]);
    expect(decide(r.score)).toBe("verify");
  });

  it("asks real people on a shared connection for an email code, not a review", () => {
    // Oct 13 pre-draw rush: real entrants held for "ip burst, subnet burst".
    const shared = scoreSignals([
      { code: "ip_burst" },
      { code: "subnet_burst" },
    ]);
    expect(shared.signals.map((s) => s.code)).toEqual(["ip_burst"]);
    expect(decide(shared.score)).toBe("verify");
    for (const extra of ["honeypot", "turnstile_missing"] as const)
      expect(
        decide(
          scoreSignals([
            { code: "ip_burst" },
            { code: "subnet_burst" },
            { code: extra },
          ]).score,
        ),
      ).toBe("verify");
    // Two other warning signs on top still hold for review.
    expect(
      decide(
        scoreSignals([
          { code: "ip_burst" },
          { code: "honeypot" },
          { code: "turnstile_missing" },
        ]).score,
      ),
    ).toBe("hold");
  });

  it("maps scores to policy decisions", () => {
    const lenient = { ...DEFAULT_RISK_POLICY, alwaysVerifyEmail: false };
    expect(decide(0, lenient)).toBe("allow");
    expect(decide(0)).toBe("verify");
    expect(decide(25, lenient)).toBe("verify");
    expect(decide(60)).toBe("hold");
    expect(decide(100)).toBe("block");
  });
});

describe("turnstile", () => {
  it("passes tokens through to Cloudflare and reads the result", async () => {
    process.env.CARDBIT_GIVEAWAY_TURNSTILE_SECRET_KEY = "secret";
    const calls: RequestInit[] = [];
    const fake = (async (_url: string, init: RequestInit) => {
      calls.push(init);
      return new Response(
        JSON.stringify({
          success: false,
          "error-codes": ["invalid-input-response"],
        }),
      );
    }) as unknown as typeof fetch;
    const r = await verifyTurnstile("tok", "1.2.3.4", fake);
    expect(r).toEqual({
      success: false,
      errorCodes: ["invalid-input-response"],
    });
    expect(String(calls[0].body)).toContain("response=tok");
    expect(await verifyTurnstile(undefined, undefined, fake)).toMatchObject({
      success: false,
    });
    delete process.env.CARDBIT_GIVEAWAY_TURNSTILE_SECRET_KEY;
  });
});

describe("subnets", () => {
  it("groups IPv4 by /24 and IPv6 by /48", () => {
    expect(subnetOf("203.0.113.77")).toBe("203.0.113.0/24");
    expect(subnetOf("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
  });
});

describe("turnstile signals", () => {
  it("only blocks a token Cloudflare calls invalid", () => {
    expect(turnstileSignal(["invalid-input-response"]).code).toBe(
      "turnstile_failed",
    );
    for (const codes of [
      ["missing-input-response"],
      ["timeout-or-duplicate"],
      ["network-error"],
      ["missing-secret"],
      ["internal-error"],
      ["invalid-input-secret"],
      [],
    ])
      expect(turnstileSignal(codes).code).toBe("turnstile_missing");
  });

  it("asks a real person hit by a Cloudflare outage for an email code", () => {
    const { score } = scoreSignals([turnstileSignal(["network-error"])]);
    expect(decide(score, DEFAULT_RISK_POLICY)).toBe("verify");
  });
});
