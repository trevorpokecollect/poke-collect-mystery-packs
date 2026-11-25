// iPhone app sign-in hand-off (OAuth-style code + PKCE, all first party).
//
// 1. The app opens /app-handoff?challenge=<base64url sha256(verifier)> in ASWebAuthenticationSession.
//    Signed out -> the normal /sign-in page (email code, Google, Apple...) returns there afterwards.
// 2. Signed in -> one-time code (2 minutes, single use, bound to the challenge), redirect to
//    cardbit://signed-in?code=...
// 3. The app POSTs {code, verifier} to /api/app/session and gets its own session token (same
//    SiteSession table and lifetime as the website; sent back as the cb_site cookie).
// A code stolen by another app that registered cardbit:// is useless without the verifier.
import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { clientIp } from "./auth.server";

export const APP_CALLBACK = "cardbit://signed-in";
const CODE_SECONDS = 120;
const APP_SESSION_DAYS = 90;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const b64urlSha = (s: string) => createHash("sha256").update(s).digest("base64url");

export class HandoffError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

/** A PKCE S256 challenge is exactly 43 base64url characters. */
export const validChallenge = (c: string | null | undefined): c is string => !!c && /^[A-Za-z0-9_-]{43}$/.test(c);
/** RFC 7636 verifier: 43-128 unreserved characters. */
export const validVerifier = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(v);

export async function startHandoff(db: PrismaClient, customerId: string, challenge: string) {
  if (!validChallenge(challenge)) throw new HandoffError("Invalid app sign-in request.", "invalid");
  const code = randomBytes(32).toString("base64url");
  await db.siteAppHandoff.create({
    data: { id: sha(code), customerId, challenge, expiresAt: new Date(Date.now() + CODE_SECONDS * 1000) },
  });
  return { code, redirect: `${APP_CALLBACK}?code=${encodeURIComponent(code)}` };
}

/** Trades a one-time code + verifier for a new session token. Single use, even under concurrent calls. */
export async function redeemHandoff(db: PrismaClient, code: unknown, verifier: unknown, request: Request) {
  if (typeof code !== "string" || code.length > 100 || !validVerifier(verifier))
    throw new HandoffError("Sign in again.", "sign_in");
  const id = sha(code);
  const row = await db.siteAppHandoff.findUnique({ where: { id } });
  if (!row || row.usedAt || row.expiresAt < new Date() || row.challenge !== b64urlSha(verifier))
    throw new HandoffError("Sign in again.", "sign_in");
  // Conditional claim: exactly one caller wins the code.
  const claimed = await db.siteAppHandoff.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw new HandoffError("Sign in again.", "sign_in");
  const customer = await db.siteCustomer.findUnique({ where: { id: row.customerId } });
  if (!customer || customer.closedAt) throw new HandoffError("Sign in again.", "sign_in");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + APP_SESSION_DAYS * 864e5);
  await db.siteSession.create({
    data: {
      id: sha(token),
      customerId: customer.id,
      ip: clientIp(request),
      userAgent: ("app:" + (request.headers.get("user-agent") || "")).slice(0, 300),
      expiresAt,
    },
  });
  return { token, expiresAt, customer };
}
