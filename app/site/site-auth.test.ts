// Sign In and Buy Cardbits dialogs: the JSON answers from /sign-in and /checkout/cardbits,
// and the full-page fallbacks staying as they were.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const auth = vi.hoisted(() => ({ customer: null as null | Record<string, unknown> }));
vi.mock("../db.server", () => ({ default: {} }));
vi.mock("./email/outbox.server", () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock("./email/mailer.server", () => ({ mailerFromEnv: () => ({}) }));
vi.mock("./core/auth.server", async (orig) => {
  const real = await orig<typeof import("./core/auth.server")>();
  return {
    ...real,
    currentCustomer: vi.fn(async () => auth.customer),
    issueEmailCode: vi.fn(async (_db: unknown, email: string) => {
      if (email === "busy@example.com") throw new real.SignInError("Too many codes requested. Try again in an hour.");
      return { id: "code1", email: email.toLowerCase(), code: "123456" };
    }),
    verifyEmailCode: vi.fn(async (_db: unknown, email: string, code: string) => {
      if (code !== "123456") throw new real.SignInError("That code is not right. Check the email and try again.");
      return { id: "cust1", email };
    }),
    createSession: vi.fn(async () => "cb_site=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"),
  };
});

import { action as signInAction, loader as signInLoader } from "../routes/sign-in";
import { action as checkoutAction } from "../routes/checkout.cardbits";
import { storefrontShell } from "./shell.server";

const form = (url: string, fields: Record<string, string>, json = true) =>
  ({
    request: new Request(url, {
      method: "POST",
      headers: json ? { Accept: "application/json" } : {},
      body: new URLSearchParams(fields),
    }),
    params: {},
    context: {},
  }) as never;

beforeEach(() => { process.env.CARDBIT_SITE = "on"; auth.customer = null; });
afterEach(() => { delete process.env.CARDBIT_SITE; });

describe("sign-in dialog API", () => {
  it("sends a code and answers in JSON", async () => {
    const res = (await signInAction(form("http://site.test/sign-in", { intent: "send", email: "A@Example.com", return_to: "/vault" }))) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, step: "code", email: "a@example.com" });
  });

  it("returns rule errors as JSON 400", async () => {
    const res = (await signInAction(form("http://site.test/sign-in", { intent: "send", email: "busy@example.com" }))) as Response;
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Too many codes/);
    const bad = (await signInAction(form("http://site.test/sign-in", { intent: "verify", email: "a@example.com", code: "000000" }))) as Response;
    expect(bad.status).toBe(400);
    expect(bad.headers.get("set-cookie")).toBeNull();
  });

  it("signs in with the session cookie and a safe return path", async () => {
    const res = (await signInAction(form("http://site.test/sign-in", { intent: "verify", email: "a@example.com", code: "123456", return_to: "//evil.example" }))) as Response;
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^cb_site=/);
    expect(await res.json()).toEqual({ ok: true, signedIn: true, returnTo: "/account" });
  });

  it("keeps the full-page fallback for plain form posts", async () => {
    const res = (await signInAction(form("http://site.test/sign-in", { intent: "verify", email: "a@example.com", code: "123456", return_to: "/vault" }, false))) as Response;
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/vault");
    const page = (await signInLoader({ request: new Request("http://site.test/sign-in"), params: {}, context: {} } as never)) as Response;
    const html = await page.text();
    expect(html).toContain("Continue With Google");
    expect(html).toContain('fill="#4285F4"'); // Google logo on the button
  });
});

describe("Buy Cardbits dialog API", () => {
  it("asks a signed-out shopper to sign in (JSON 401) instead of redirecting", async () => {
    const res = (await checkoutAction(form("http://site.test/checkout/cardbits", { amount: "1000", state: "TX", zip: "75001" }))) as Response;
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "sign_in" });
    const page = (await checkoutAction(form("http://site.test/checkout/cardbits", { amount: "1000" }, false))) as Response;
    expect(page.status).toBe(303);
    expect(page.headers.get("location")).toMatch(/^\/sign-in\?return_to=/);
  });

  it("rejects an unknown package and a bad ZIP as JSON", async () => {
    auth.customer = { id: "cust1", email: "a@example.com", frozenAt: null, closedAt: null };
    process.env.COINFLOW_API_KEY = "test-key";
    process.env.COINFLOW_API_BASE = "https://coinflow.invalid/api";
    try {
      const odd = (await checkoutAction(form("http://site.test/checkout/cardbits", { amount: "777", state: "TX", zip: "75001" }))) as Response;
      expect(odd.status).toBe(400);
      expect((await odd.json()).error).toMatch(/package/);
      const zip = (await checkoutAction(form("http://site.test/checkout/cardbits", { amount: "1000", state: "TX", zip: "75" }))) as Response;
      expect(zip.status).toBe(400);
      expect((await zip.json()).error).toMatch(/ZIP/);
    } finally {
      delete process.env.COINFLOW_API_KEY;
      delete process.env.COINFLOW_API_BASE;
    }
  });
});

describe("storefront shell", () => {
  it("loads the dialog script and styles", () => {
    const html = storefrontShell();
    expect(html).toMatch(/\/site\/js\/cardbit-site-auth\.js\?v=\w+/);
    expect(html).toMatch(/\/site\/css\/cardbit-site-auth\.css\?v=\w+/);
    const js = readFileSync("public/site/js/cardbit-site-auth.js", "utf8");
    // Excluded sale states can't be picked for billing.
    for (const s of ["AL", "HI", "ID", "MN", "NV", "NY", "UT", "WA"]) expect(js).not.toContain(`['${s}',`);
  });
});
