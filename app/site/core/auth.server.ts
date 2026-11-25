// Standalone-site customer accounts: email code + Google sign-in, cookie sessions.
// One account per email. Session tokens are random; only their sha256 is stored.
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { PrismaClient, SiteCustomer } from "@prisma/client";

export const SESSION_COOKIE = "cb_site";
// Sessions roll: each visit pushes expiry out to 90 days (written at most once a day), so a
// regular collector rarely signs in again. The cookie itself lives ~400 days (browser cap);
// the server-side expiry is what counts.
const SESSION_DAYS = 90;
const COOKIE_DAYS = 400;
const ROLL_AFTER_MS = 864e5;
const CODE_MINUTES = 10;
const CODE_ATTEMPTS = 5;
const CODES_PER_HOUR = 5;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const validEmail = (e: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);

export function cookieValue(request: Request, name: string) {
  const m = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
const secure = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");
export const setCookie = (name: string, value: string, maxAgeSec: number) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure()}`;
export const clearCookie = (name: string) => `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`;

export function clientIp(request: Request) {
  return (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
}

/** Only same-origin relative paths are allowed as return targets. */
export function safeReturn(to: string | null | undefined) {
  if (!to || !to.startsWith("/") || to.startsWith("//") || to.startsWith("/\\")) return "/account";
  return to.slice(0, 500);
}

export async function createSession(db: PrismaClient, customerId: string, request: Request) {
  const token = randomBytes(32).toString("base64url");
  await db.siteSession.create({
    data: {
      id: sha(token),
      customerId,
      ip: clientIp(request),
      userAgent: (request.headers.get("user-agent") || "").slice(0, 300),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5),
    },
  });
  return setCookie(SESSION_COOKIE, token, COOKIE_DAYS * 86400);
}

export async function currentCustomer(db: PrismaClient, request: Request): Promise<SiteCustomer | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const s = await db.siteSession.findUnique({ where: { id: sha(token) } });
  if (!s || s.revokedAt || s.expiresAt < new Date()) return null;
  const c = await db.siteCustomer.findUnique({ where: { id: s.customerId } });
  if (!c || c.closedAt) return null;
  const rolled = new Date(Date.now() + SESSION_DAYS * 864e5);
  if (rolled.getTime() - s.expiresAt.getTime() > ROLL_AFTER_MS) {
    await db.siteSession
      .updateMany({ where: { id: s.id, revokedAt: null }, data: { expiresAt: rolled } })
      .catch((e) => console.warn("[site] session roll failed", (e as Error).message));
  }
  return c;
}

export async function endSession(db: PrismaClient, request: Request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await db.siteSession.updateMany({ where: { id: sha(token) }, data: { revokedAt: new Date() } });
  return clearCookie(SESSION_COOKIE);
}

export class SignInError extends Error {}

/** Creates a code and returns it for the caller to email. Never log or store the plain code. */
export async function issueEmailCode(db: PrismaClient, rawEmail: string, ip: string | null) {
  const email = normalizeEmail(rawEmail);
  if (!validEmail(email)) throw new SignInError("Enter a valid email address.");
  const recent = await db.siteEmailCode.count({
    where: { email, createdAt: { gt: new Date(Date.now() - 3600e3) } },
  });
  if (recent >= CODES_PER_HOUR) throw new SignInError("Too many codes requested. Try again in an hour.");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const row = await db.siteEmailCode.create({
    data: { email, codeHash: sha(`${email}:${code}`), expiresAt: new Date(Date.now() + CODE_MINUTES * 60e3), ip },
  });
  return { id: row.id, email, code };
}

export async function verifyEmailCode(db: PrismaClient, rawEmail: string, rawCode: string) {
  const email = normalizeEmail(rawEmail);
  const code = rawCode.replace(/\D/g, "");
  const row = await db.siteEmailCode.findFirst({
    where: { email, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!row || row.attempts >= CODE_ATTEMPTS) throw new SignInError("That code has expired. Request a new one.");
  const ok =
    code.length === 6 && timingSafeEqual(Buffer.from(row.codeHash), Buffer.from(sha(`${email}:${code}`)));
  if (!ok) {
    await db.siteEmailCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw new SignInError("That code is not right. Check the email and try again.");
  }
  const used = await db.siteEmailCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (!used.count) throw new SignInError("That code was already used. Request a new one.");
  return upsertCustomer(db, { email });
}

export async function upsertCustomer(
  db: PrismaClient,
  p: { email: string; googleSub?: string; name?: string | null },
): Promise<SiteCustomer> {
  const email = normalizeEmail(p.email);
  const existing = await db.siteCustomer.findUnique({ where: { email } });
  if (existing) {
    if (existing.closedAt) throw new SignInError("This account is closed. Contact hello@cardbit.com.");
    if (p.googleSub && existing.googleSub && existing.googleSub !== p.googleSub)
      throw new SignInError("This email is linked to a different Google account.");
    if ((p.googleSub && !existing.googleSub) || (p.name && !existing.name))
      return db.siteCustomer.update({
        where: { id: existing.id },
        data: { googleSub: existing.googleSub ?? p.googleSub, name: existing.name ?? p.name ?? null },
      });
    return existing;
  }
  try {
    return await db.siteCustomer.create({ data: { email, googleSub: p.googleSub ?? null, name: p.name ?? null } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return db.siteCustomer.findUniqueOrThrow({ where: { email } });
    throw e;
  }
}

// ---- Google OAuth (authorization code + PKCE) ------------------------------------------------
const GOOGLE_STATE = "cb_site_g";
export function siteOrigin() {
  return (process.env.SITE_ORIGIN || process.env.CARDBIT_SITE_URL || "https://app-site-site.up.railway.app").replace(/\/$/, "");
}
export function googleStart(returnTo: string, opts: { age?: boolean } = {}) {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new SignInError("Google sign-in is not set up yet. Use an email code.");
  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: id,
    redirect_uri: `${siteOrigin()}/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  const cookie = setCookie(GOOGLE_STATE, JSON.stringify({ state, verifier, returnTo: safeReturn(returnTo), age: opts.age === true }), 600);
  return { url: url.toString(), cookie };
}

export async function googleFinish(db: PrismaClient, request: Request, fetcher: typeof fetch = fetch) {
  const url = new URL(request.url);
  const saved = (() => {
    try {
      return JSON.parse(cookieValue(request, GOOGLE_STATE) || "null");
    } catch {
      return null;
    }
  })();
  const state = url.searchParams.get("state");
  if (!saved || !state || saved.state !== state) throw new SignInError("Sign-in expired. Please try again.");
  const code = url.searchParams.get("code");
  if (!code) throw new SignInError("Google sign-in was cancelled.");
  const tokenRes = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: `${siteOrigin()}/auth/google/callback`,
      grant_type: "authorization_code",
      code_verifier: saved.verifier,
    }),
  });
  if (!tokenRes.ok) throw new SignInError("Google sign-in failed. Please try again.");
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  const infoRes = await fetcher("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!infoRes.ok) throw new SignInError("Google sign-in failed. Please try again.");
  const info = (await infoRes.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string };
  if (!info.sub || !info.email || info.email_verified !== true)
    throw new SignInError("Your Google account needs a verified email.");
  const customer = await upsertCustomer(db, { email: info.email, googleSub: info.sub, name: info.name ?? null });
  return { customer, returnTo: safeReturn(saved.returnTo), age: saved.age === true, clearState: clearCookie(GOOGLE_STATE) };
}
