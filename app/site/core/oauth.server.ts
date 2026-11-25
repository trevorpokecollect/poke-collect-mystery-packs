// Extra sign-in providers for the standalone site: Discord and Sign in with Apple.
// Both are off until their keys are set; the storefront only shows buttons for configured ones.
// Accounts are matched by verified email (one account per email, like Google and email codes).
import { createPrivateKey, randomBytes, sign } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { SignInError, clearCookie, cookieValue, safeReturn, siteOrigin, upsertCustomer } from "./auth.server";

export type OAuthProvider = "discord" | "apple";
type Env = NodeJS.ProcessEnv;

export function providerConfigured(p: OAuthProvider | "google", env: Env = process.env) {
  if (p === "google") return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  if (p === "discord") return Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);
  return Boolean(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY);
}
export const signInProviders = (env: Env = process.env) =>
  (["google", "apple", "discord"] as const).filter((p) => providerConfigured(p, env));

const stateCookie = (p: OAuthProvider) => `cb_site_${p}`;
const redirectUri = (p: OAuthProvider) => `${siteOrigin()}/auth/${p}/callback`;
const NAMES = { discord: "Discord", apple: "Apple" } as const;

// Apple returns to us with a cross-site POST (response_mode=form_post), which drops SameSite=Lax
// cookies, so its state cookie must be SameSite=None (which requires Secure).
function setStateCookie(p: OAuthProvider, value: string) {
  const prod = process.env.NODE_ENV === "production";
  const same = p === "apple" && prod ? "None" : "Lax";
  return `${stateCookie(p)}=${encodeURIComponent(value)}; Path=/auth/${p}; HttpOnly; SameSite=${same}; Max-Age=600${prod ? "; Secure" : ""}`;
}
const clearStateCookie = (p: OAuthProvider) => `${clearCookie(stateCookie(p))}`.replace("Path=/", `Path=/auth/${p}`);

export function oauthStart(p: OAuthProvider, returnTo: string, opts: { age?: boolean } = {}, env: Env = process.env) {
  if (!providerConfigured(p, env)) throw new SignInError(`${NAMES[p]} sign-in is not set up yet.`);
  const state = randomBytes(16).toString("base64url");
  const url =
    p === "discord"
      ? new URL("https://discord.com/oauth2/authorize")
      : new URL("https://appleid.apple.com/auth/authorize");
  url.search = new URLSearchParams(
    p === "discord"
      ? { client_id: env.DISCORD_CLIENT_ID!, redirect_uri: redirectUri(p), response_type: "code", scope: "identify email", state, prompt: "none" }
      : { client_id: env.APPLE_CLIENT_ID!, redirect_uri: redirectUri(p), response_type: "code", scope: "name email", response_mode: "form_post", state },
  ).toString();
  const cookie = setStateCookie(p, JSON.stringify({ state, returnTo: safeReturn(returnTo), age: opts.age === true }));
  return { url: url.toString(), cookie };
}

/** iPhone app bundle IDs that may sign in with Apple natively (identity token aud). */
export const appleAppIds = (env: Env = process.env) =>
  (env.APPLE_APP_BUNDLE_IDS ?? "com.cardbit.app,com.cardbit.app.dev").split(",").map((s) => s.trim()).filter(Boolean);

/** The ES256 client secret Apple requires, signed with the .p8 key (valid 5 minutes).
 *  `clientId` is the web Services ID, or an app bundle ID for codes issued to the iPhone app. */
export function appleClientSecret(env: Env = process.env, now = Math.floor(Date.now() / 1000), clientId = env.APPLE_CLIENT_ID) {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "ES256", kid: env.APPLE_KEY_ID });
  const body = b64({ iss: env.APPLE_TEAM_ID, iat: now, exp: now + 300, aud: "https://appleid.apple.com", sub: clientId });
  const key = createPrivateKey(String(env.APPLE_PRIVATE_KEY).replace(/\\n/g, "\n"));
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${head}.${body}.${sig}`;
}

function jwtPayload(token: string) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Trade an Apple authorization code for the verified email. `clientId` must be the one the code
 * was issued to: the web Services ID, or an iPhone app bundle ID (native Sign in with Apple).
 * The id_token comes straight from Apple's token endpoint over TLS; its aud must match.
 */
export async function appleExchange(code: string, clientId: string, fetcher: typeof fetch = fetch, env: Env = process.env) {
  const allowed = [env.APPLE_CLIENT_ID, ...appleAppIds(env)].filter(Boolean);
  if (!allowed.includes(clientId)) throw new SignInError("Apple sign-in failed. Please try again.");
  const web = clientId === env.APPLE_CLIENT_ID;
  const tokenRes = await fetcher("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: appleClientSecret(env, undefined, clientId),
      grant_type: "authorization_code",
      code,
      // Native codes carry no redirect URI.
      ...(web ? { redirect_uri: redirectUri("apple") } : {}),
    }),
  });
  if (!tokenRes.ok) throw new SignInError("Apple sign-in failed. Please try again.");
  const { id_token } = (await tokenRes.json()) as { id_token?: string };
  const claims = id_token ? jwtPayload(id_token) : null;
  const verified = claims?.email_verified === true || claims?.email_verified === "true";
  if (!claims || claims.aud !== clientId || claims.iss !== "https://appleid.apple.com" || !claims.email || !verified)
    throw new SignInError("Your Apple ID needs a verified email.");
  return { email: String(claims.email), sub: String(claims.sub || "") };
}

/**
 * Finish a Discord (GET query) or Apple (POST form) callback. Identity comes only from the
 * provider's own token/user endpoints over TLS, never from the browser's parameters.
 */
export async function oauthFinish(
  db: PrismaClient,
  p: OAuthProvider,
  request: Request,
  params: URLSearchParams,
  fetcher: typeof fetch = fetch,
  env: Env = process.env,
) {
  const saved = (() => {
    try {
      return JSON.parse(cookieValue(request, stateCookie(p)) || "null");
    } catch {
      return null;
    }
  })();
  const state = params.get("state");
  if (!saved || !state || saved.state !== state) throw new SignInError("Sign-in expired. Please try again.");
  const code = params.get("code");
  if (!code) throw new SignInError(`${NAMES[p]} sign-in was cancelled.`);
  const failed = `${NAMES[p]} sign-in failed. Please try again.`;

  let email: string | undefined, name: string | null = null;
  if (p === "discord") {
    const tokenRes = await fetcher("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID || "",
        client_secret: env.DISCORD_CLIENT_SECRET || "",
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(p),
      }),
    });
    if (!tokenRes.ok) throw new SignInError(failed);
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    const me = await fetcher("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${access_token}` } });
    if (!me.ok) throw new SignInError(failed);
    const u = (await me.json()) as { email?: string | null; verified?: boolean; global_name?: string | null; username?: string };
    if (!u.email || u.verified !== true) throw new SignInError("Your Discord account needs a verified email.");
    email = u.email;
    name = u.global_name || u.username || null;
  } else {
    ({ email } = await appleExchange(code, env.APPLE_CLIENT_ID || "", fetcher, env));
    // Apple sends the name only on the first sign-in, in the form's "user" field.
    try {
      const user = JSON.parse(params.get("user") || "null") as { name?: { firstName?: string; lastName?: string } } | null;
      name = [user?.name?.firstName, user?.name?.lastName].filter(Boolean).join(" ") || null;
    } catch {
      name = null;
    }
  }
  const customer = await upsertCustomer(db, { email, name, method: p });
  return { customer, returnTo: safeReturn(saved.returnTo), age: saved.age === true, clearState: clearStateCookie(p) };
}
