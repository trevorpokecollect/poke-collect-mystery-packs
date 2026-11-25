import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emailKeyOf, isDisposable, FOUNDING, FOUNDING_TOTAL } from "./waitlist.server";
import { gateApi, gatePage, gatePass, previewRedirect, PREVIEW_COOKIE } from "./gate.server";
import { waitlistPage } from "./page.server";

const KEY = "preview-key-0123456789";
const on = { CARDBIT_WAITLIST: "on", CARDBIT_PREVIEW_KEY: KEY } as NodeJS.ProcessEnv;

describe("waitlist emails", () => {
  it("normalizes Gmail dots and +tags for the duplicate check", () => {
    expect(emailKeyOf("Ash.Ketchum+cards@GMAIL.com")?.key).toBe("ashketchum@gmail.com");
    expect(emailKeyOf("a.sh@googlemail.com")?.key).toBe("ash@gmail.com");
    expect(emailKeyOf("misty+1@outlook.com")?.key).toBe("misty@outlook.com");
    expect(emailKeyOf("brock.s@outlook.com")?.key).toBe("brock.s@outlook.com"); // dots matter outside Gmail
  });
  it("refuses bad and throwaway addresses", () => {
    expect(emailKeyOf("nope")).toBeNull();
    expect(emailKeyOf("+@gmail.com")).toBeNull();
    expect(isDisposable("mailinator.com")).toBe(true);
    expect(isDisposable("sub.yopmail.com")).toBe(true);
    expect(isDisposable("gmail.com")).toBe(false);
  });
  it("bonus is 1,000 Cardbits: 400 email + 600 text", () => {
    expect(FOUNDING).toEqual({ email: 400, sms: 600 });
    expect(FOUNDING_TOTAL).toBe(1000);
  });
});

describe("coming-soon gate", () => {
  const req = (path: string, cookie?: string) => new Request("https://cardbit.com" + path, { headers: cookie ? { cookie } : {} });

  it("is open when CARDBIT_WAITLIST is off", () => {
    expect(gatePass(req("/packs"), {} as NodeJS.ProcessEnv)).toBe(true);
  });
  it("blocks the public and lets the preview cookie through", () => {
    expect(gatePass(req("/packs"), on)).toBe(false);
    const set = previewRedirect(req("/?preview=" + KEY + "&utm_source=x"), on)!;
    expect(set.status).toBe(302);
    expect(set.headers.get("Location")).toBe("/?utm_source=x");
    const cookie = set.headers.get("Set-Cookie")!;
    expect(cookie).toContain(PREVIEW_COOKIE + "=");
    expect(cookie).toContain("HttpOnly");
    expect(gatePass(req("/packs", cookie.split(";")[0]), on)).toBe(true);
    expect(gatePass(req("/packs", PREVIEW_COOKIE + "=forged"), on)).toBe(false);
  });
  it("a wrong key sets nothing; preview=off clears", () => {
    const bad = previewRedirect(req("/?preview=guess"), on)!;
    expect(bad.headers.get("Set-Cookie")).toBeNull();
    expect(previewRedirect(req("/?preview=off"), on)!.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
  it("a short key never opens the site", () => {
    const weak = { CARDBIT_WAITLIST: "on", CARDBIT_PREVIEW_KEY: "short" } as NodeJS.ProcessEnv;
    expect(previewRedirect(req("/?preview=short"), weak)!.headers.get("Set-Cookie")).toBeNull();
  });
  it("pages redirect home and APIs refuse while gated", async () => {
    const before = process.env.CARDBIT_WAITLIST;
    process.env.CARDBIT_WAITLIST = "on";
    try {
      expect(gatePage(req("/packs"))!.headers.get("Location")).toBe("/");
      const api = gateApi(req("/api/store/state"))!;
      expect(api.status).toBe(403);
      expect((await api.json()).code).toBe("waitlist");
    } finally {
      if (before === undefined) delete process.env.CARDBIT_WAITLIST;
      else process.env.CARDBIT_WAITLIST = before;
    }
  });
});

describe("waitlist page", () => {
  const html = waitlistPage({ SITE_ORIGIN: "https://cardbit.com" } as NodeJS.ProcessEnv);
  if (process.env.WL_RENDER) writeFileSync(process.env.WL_RENDER, html);

  it("has the offer, both consents and policy links", () => {
    expect(html).toContain("1,000");
    expect(html).toContain("Founding Collector");
    expect(html).toContain('name="emailConsent"');
    expect(html).toContain("Recurring Automated Marketing Texts");
    expect(html).toContain('href="/policies#sms-terms"');
    expect(html).toContain('href="/official-rules"');
    expect(html).toContain("Hosted by Poke-Collect.");
    expect(html).toContain("Launching Soon");
  });
  it("shows no dollar values or tiers", () => {
    const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
    expect(text).not.toMatch(/\$(?!1\.00)\d/); // only the 100 Cardbits = $1.00 rate
    expect(text).not.toMatch(/Common|Uncommon|Rare Tier|Legendary|Epic/);
  });
  it("is indexable with a canonical home link", () => {
    expect(html).toContain('<link rel="canonical" href="https://cardbit.com/">');
  });
});
