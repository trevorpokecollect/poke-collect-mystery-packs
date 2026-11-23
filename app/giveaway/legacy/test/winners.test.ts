import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  claimFormSchema,
  claimState,
  consolationCode,
  escapeHtml,
  fillTemplate,
  fillTemplateHtml,
  issueClaimToken,
  publicName,
  readClaimToken,
} from "../app/lib/winners";
import { signBody } from "../app/lib/webhook-out.server";

const SECRET = "test-secret";

describe("templates", () => {
  const vars = {
    prize: "Booster Box",
    title: "Fall Giveaway",
    claim_url: "https://x/c",
  };

  it("fills placeholders and leaves unknown tags alone", () => {
    expect(
      fillTemplate(
        "Won {{prize}} in {{ title }}: {{claim_url}} {{other}}",
        vars,
      ),
    ).toBe("Won Booster Box in Fall Giveaway: https://x/c {{other}}");
  });

  it("escapes merchant text but inserts html vars as given", () => {
    expect(
      fillTemplateHtml("<b>{{prize}}</b> & {{claim_url}}", {
        prize: "<strong>Box</strong>",
        claim_url: '<a href="u">u</a>',
      }),
    ).toBe('&lt;b&gt;<strong>Box</strong>&lt;/b&gt; &amp; <a href="u">u</a>');
  });

  it("neutralizes Liquid braces", () => {
    expect(escapeHtml("{{ shop.name }}")).not.toContain("{");
  });
});

describe("publicName", () => {
  it("shows first name and last initial only", () => {
    expect(publicName("Ash Ketchum", "a@x.com")).toBe("Ash K.");
    expect(publicName("Misty", "m@x.com")).toBe("Misty");
    expect(publicName("  Brock  van  Pewter ", "b@x.com")).toBe("Brock P.");
    expect(publicName(null, "gary@x.com")).toBe("G.");
  });
});

describe("claim tokens", () => {
  it("round-trips and rejects tampering", () => {
    const exp = new Date(Date.now() + DAY_MS);
    const t = issueClaimToken(SECRET, "win123", exp);
    const r = readClaimToken(SECRET, t)!;
    expect(r.winnerId).toBe("win123");
    expect(r.expired).toBe(false);
    expect(readClaimToken("other", t)).toBeNull();
    expect(readClaimToken(SECRET, t.replace("win123", "win124"))).toBeNull();
    expect(readClaimToken(SECRET, "a.b.c")).toBeNull();
    expect(readClaimToken(SECRET, undefined)).toBeNull();
  });

  it("reports expiry", () => {
    const t = issueClaimToken(SECRET, "w", new Date(Date.now() - 1000));
    expect(readClaimToken(SECRET, t)!.expired).toBe(true);
  });
});

describe("claimState", () => {
  const now = new Date("2026-01-10T00:00:00Z");
  const base = { claimedAt: null, forfeited: false, notifiedAt: null };
  it("walks through the lifecycle", () => {
    expect(claimState(base, 7, now)).toBe("not_sent");
    expect(
      claimState({ ...base, notifiedAt: new Date("2026-01-05") }, 7, now),
    ).toBe("open");
    expect(
      claimState({ ...base, notifiedAt: new Date("2026-01-01") }, 7, now),
    ).toBe("expired");
    expect(claimState({ ...base, claimedAt: now }, 7, now)).toBe("claimed");
    expect(claimState({ ...base, forfeited: true }, 7, now)).toBe("forfeited");
  });
});

describe("claim form", () => {
  const good = {
    name: "Ash Ketchum",
    address1: "1 Route 1",
    city: "Pallet",
    zip: "12345",
    country: "United States",
    phone: "+1 (555) 123-4567",
  };
  it("accepts a complete address", () => {
    expect(claimFormSchema.safeParse(good).success).toBe(true);
  });
  it("rejects missing fields and bad phones", () => {
    expect(claimFormSchema.safeParse({ ...good, city: " " }).success).toBe(
      false,
    );
    expect(
      claimFormSchema.safeParse({ ...good, phone: "call me" }).success,
    ).toBe(false);
  });
});

describe("consolationCode", () => {
  it("is stable per entrant and unique across entrants", () => {
    expect(consolationCode("c1", "e1")).toBe(consolationCode("c1", "e1"));
    expect(consolationCode("c1", "e1")).not.toBe(consolationCode("c1", "e2"));
    expect(consolationCode("c1", "e1")).toMatch(/^PC-THANKS-[A-Z0-9]{8}$/);
  });
});

describe("outbound webhook signature", () => {
  it("is sha256 HMAC of the raw body", () => {
    const body = JSON.stringify({ event: "draw.completed" });
    expect(signBody(body, SECRET)).toBe(
      `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`,
    );
  });
});

describe("hasFullName", () => {
  it("needs a first and a last name", async () => {
    const { hasFullName } = await import("../app/lib/entries/signup.server");
    expect(hasFullName("Emily Smith")).toBe(true);
    expect(hasFullName("  José  Núñez ")).toBe(true);
    expect(hasFullName("Emily")).toBe(false);
    expect(hasFullName("Emily 5")).toBe(false);
    expect(hasFullName(null)).toBe(false);
  });
});
