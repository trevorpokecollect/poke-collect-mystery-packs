// Sign In and Buy Cardbits dialogs: the JSON answers from /sign-in and /checkout/cardbits,
// and the full-page fallbacks staying as they were.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const auth = vi.hoisted(() => ({ customer: null as null | Record<string, unknown> }));
vi.mock("../db.server", () => ({ default: {} }));
vi.mock("./email/outbox.server", () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock("./email/mailer.server", () => ({ mailerFromEnv: () => ({}) }));
// Limits & breaks have their own integration tests; here the db is a stub, so treat them as unset.
vi.mock("./play/limits.server", async (orig) => ({
  ...(await orig<typeof import("./play/limits.server")>()),
  assertNotPaused: vi.fn(async () => undefined),
  assertWithinLimits: vi.fn(async () => undefined),
}));
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

describe("more sign-in options", () => {
  it("shows only configured providers", async () => {
    const { signInProviders } = await import("./core/oauth.server");
    expect(signInProviders({})).toEqual([]);
    expect(signInProviders({ GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s", DISCORD_CLIENT_ID: "d", DISCORD_CLIENT_SECRET: "s" })).toEqual(["google", "discord"]);
  });

  it("starts Discord and Apple with state cookies; Apple uses form_post", async () => {
    const { oauthStart } = await import("./core/oauth.server");
    const env = { DISCORD_CLIENT_ID: "d", DISCORD_CLIENT_SECRET: "s", APPLE_CLIENT_ID: "com.cardbit.web", APPLE_TEAM_ID: "T", APPLE_KEY_ID: "K", APPLE_PRIVATE_KEY: "x" };
    const d = oauthStart("discord", "/vault", { age: true }, env);
    expect(new URL(d.url).searchParams.get("scope")).toBe("identify email");
    expect(d.cookie).toMatch(/^cb_site_discord=.*Path=\/auth\/discord/);
    expect(decodeURIComponent(d.cookie)).toContain('"age":true');
    const a = oauthStart("apple", "//evil", {}, env);
    expect(new URL(a.url).searchParams.get("response_mode")).toBe("form_post");
    expect(decodeURIComponent(a.cookie)).toContain('"returnTo":"/account"');
    expect(() => oauthStart("discord", "/", {}, {})).toThrow(/not set up/);
  });

  it("signs the Apple client secret with the .p8 key (ES256)", async () => {
    const { generateKeyPairSync, verify } = await import("node:crypto");
    const { appleClientSecret } = await import("./core/oauth.server");
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n");
    const jwt = appleClientSecret({ APPLE_CLIENT_ID: "com.cardbit.web", APPLE_TEAM_ID: "TEAM", APPLE_KEY_ID: "KEY", APPLE_PRIVATE_KEY: pem }, 1000);
    const [h, b, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY" });
    expect(JSON.parse(Buffer.from(b, "base64url").toString())).toMatchObject({ iss: "TEAM", sub: "com.cardbit.web", aud: "https://appleid.apple.com", exp: 1300 });
    expect(verify("sha256", Buffer.from(`${h}.${b}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("finishes Discord only with a verified email and a matching state", async () => {
    const { oauthFinish } = await import("./core/oauth.server");
    const env = { DISCORD_CLIENT_ID: "d", DISCORD_CLIENT_SECRET: "s" };
    const created: unknown[] = [];
    const db = {
      siteCustomer: {
        findUnique: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => (created.push(data), { id: "c9", ...data }),
      },
    } as never;
    const cookie = `cb_site_discord=${encodeURIComponent(JSON.stringify({ state: "abc", returnTo: "/vault", age: true }))}`;
    const req = new Request("http://site.test/auth/discord/callback", { headers: { cookie } });
    const fetcher = (verified: boolean) =>
      (async (url: string) =>
        new Response(JSON.stringify(String(url).includes("token") ? { access_token: "t" } : { email: "Ash@Example.com", verified, global_name: "Ash" }))) as never;
    await expect(oauthFinish(db, "discord", req, new URLSearchParams("state=nope&code=x"), fetcher(true), env)).rejects.toThrow(/expired/);
    await expect(oauthFinish(db, "discord", req, new URLSearchParams("state=abc&code=x"), fetcher(false), env)).rejects.toThrow(/verified email/);
    const r = await oauthFinish(db, "discord", req, new URLSearchParams("state=abc&code=x"), fetcher(true), env);
    expect(r).toMatchObject({ returnTo: "/vault", age: true });
    expect(created).toEqual([{ email: "ash@example.com", googleSub: null, name: "Ash" }]);
  });

  it("puts a one-tap link in the code email with the code only in the #fragment", async () => {
    const { renderEmail } = await import("./email/templates");
    const r = renderEmail("signin_code", { code: "482913", minutes: 10, email: "a@example.com", returnTo: "/vault" }, { SITE_ORIGIN: "https://cardbit.com" } as never);
    expect(r.html).toContain("https://cardbit.com/sign-in/link?e=a%40example.com&amp;rt=%2Fvault#c=482913");
    expect(r.text).toContain("#c=482913");
    expect(renderEmail("signin_code", { code: "482913", minutes: 10 }).html).not.toContain("/sign-in/link");
  });
});

describe("iPhone app Sign in with Apple", () => {
  it("accepts the app bundle IDs as audiences and signs the secret for them", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const { appleExchange, appleAppIds } = await import("./core/oauth.server");
    const pem = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const env = { APPLE_CLIENT_ID: "com.cardbit.web", APPLE_TEAM_ID: "T", APPLE_KEY_ID: "K", APPLE_PRIVATE_KEY: pem };
    expect(appleAppIds(env)).toEqual(["com.cardbit.app", "com.cardbit.app.dev"]);
    const idToken = (aud: string) => `x.${Buffer.from(JSON.stringify({ iss: "https://appleid.apple.com", aud, sub: "001", email: "a@privaterelay.appleid.com", email_verified: "true" })).toString("base64url")}.y`;
    let sent: URLSearchParams | null = null;
    const fetcher = (aud: string) => (async (_u: string, init: RequestInit) => {
      sent = new URLSearchParams(String(init.body));
      return new Response(JSON.stringify({ id_token: idToken(aud) }));
    }) as never;
    await expect(appleExchange("c", "com.cardbit.app", fetcher("com.cardbit.app"), env)).resolves.toMatchObject({ email: "a@privaterelay.appleid.com" });
    expect(sent!.get("client_id")).toBe("com.cardbit.app");
    expect(sent!.has("redirect_uri")).toBe(false);
    const secretSub = JSON.parse(Buffer.from(sent!.get("client_secret")!.split(".")[1], "base64url").toString()).sub;
    expect(secretSub).toBe("com.cardbit.app");
    // Web codes keep the redirect URI and the Services ID.
    await appleExchange("c", "com.cardbit.web", fetcher("com.cardbit.web"), env);
    expect(sent!.get("redirect_uri")).toMatch(/\/auth\/apple\/callback$/);
    // Wrong audience back from Apple, or a client ID that isn't ours, is refused.
    await expect(appleExchange("c", "com.cardbit.app", fetcher("com.cardbit.web"), env)).rejects.toThrow();
    await expect(appleExchange("c", "com.evil.app", fetcher("com.evil.app"), env)).rejects.toThrow();
  });
});
