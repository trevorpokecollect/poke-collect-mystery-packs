// Fraud guard for the standalone site. Reuses the pure rules from app/lib/cardbit-guard.ts (the same
// numbers the Shopify path uses) against site tables:
// - Risk review: a flagged top-up (risk.server.ts) pauses shipping until staff clear the account.
// - Optional top-up caps for new accounts (SITE_TOPUP_CAPS=on; off by default).
// - Per-customer rate limits on paid and shipping actions, per-IP limits on sign-in codes.
// - 3D Secure on every top-up from a new account, a first top-up, or $100 and up.
// SITE_GUARD=on (default) refuses; "log" only logs what it would refuse; "off" skips it.
// Staff test accounts (SITE_STAFF_EMAILS) are treated as trusted.
import type { Prisma, PrismaClient } from "@prisma/client";
import { RATE_LIMITS, holdConfig, threeDSecure, topupAllowance, type GuardAction } from "../../lib/cardbit-guard";
import { topupCentsSince } from "../play/limits.server";
import { staffEmails } from "../shipping/staff.server";

type Db = PrismaClient | Prisma.TransactionClient;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type SiteGuardMode = "off" | "log" | "on";
export function siteGuardMode(env: NodeJS.ProcessEnv = process.env): SiteGuardMode {
  const v = env.SITE_GUARD;
  return v === "off" ? "off" : v === "log" ? "log" : "on";
}

export class GuardRefused extends Error {
  constructor(
    readonly code: "rate_limited" | "topup_cap" | "ship_hold" | "signin_limited",
    message: string,
    readonly status = 429,
  ) {
    super(message);
    this.name = "GuardRefused";
  }
}

function refuse(e: GuardRefused, env: NodeJS.ProcessEnv) {
  const mode = siteGuardMode(env);
  if (mode === "off") return;
  if (mode === "log") {
    console.warn(`[site-guard] would refuse ${e.code}: ${e.message}`);
    return;
  }
  throw e;
}

const isStaff = (email: string | null | undefined, env: NodeJS.ProcessEnv) => !!email && staffEmails(env).has(email.trim().toLowerCase());

// ---- Rate limits (in memory; one replica, resets on deploy) ------------------------------------
const hits = new Map<string, number[]>();
let sweptAt = 0;

/** True when one more event for this key stays under perMinute and perHour. Records the event. */
export function takeToken(key: string, limit: { perMinute: number; perHour: number }, now = Date.now()) {
  if (now - sweptAt > 10 * 60_000) {
    for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > HOUR) hits.delete(k);
    sweptAt = now;
  }
  const list = (hits.get(key) ?? []).filter((t) => now - t < HOUR);
  const lastMinute = list.filter((t) => now - t < 60_000).length;
  if (lastMinute >= limit.perMinute || list.length >= limit.perHour) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  return true;
}
export const resetRateLimits = () => hits.clear();

const STORE_ACTION: Record<string, GuardAction | undefined> = { open: "pack", buy: "pack", buyback: "buyback", ship: "ship", "ship-group": "ship" };

/** Per-customer limit for a storefront action (open, buy, buyback, ship). Other actions pass. */
export function assertRate(customerId: string, action: string, env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  const g = STORE_ACTION[action] ?? (action === "topup" ? "topup" : undefined);
  if (!g) return;
  if (!takeToken(`c:${customerId}:${g}`, RATE_LIMITS[g], now))
    refuse(new GuardRefused("rate_limited", "You're going a little fast. Wait a minute and try again."), env);
}

/** Sign-in codes: at most 20 per IP per hour and 5 per minute (the per-email limit is in auth.server). */
export async function assertSignInRate(db: Db, ip: string | null, env: NodeJS.ProcessEnv = process.env, now = new Date()) {
  if (!ip) return;
  if (!takeToken(`ip:${ip}:signin`, { perMinute: 5, perHour: 20 }, now.getTime())) {
    refuse(new GuardRefused("signin_limited", "Too many sign-in codes from this connection. Try again later."), env);
    return;
  }
  // Survives a deploy: the stored codes carry the IP.
  const lastHour = await db.siteEmailCode.count({ where: { ip, createdAt: { gt: new Date(now.getTime() - HOUR) } } });
  if (lastHour >= 20) refuse(new GuardRefused("signin_limited", "Too many sign-in codes from this connection. Try again later."), env);
}

// ---- Top-up caps -----------------------------------------------------------------------------
async function paidTopups(db: Db, customerId: string) {
  return db.siteTopup.count({ where: { customerId, status: { in: ["CREDITED", "CHARGEBACK_WON"] } } });
}

/** Throws when this top-up would go over the new-account or daily cap. Call under the customer's top-up lock. */
export async function assertTopupAllowed(
  db: Db,
  customer: { id: string; email: string; createdAt: Date },
  cents: number,
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
) {
  // Trevor (Nov 25): no blanket caps; risky payments are reviewed instead. Caps stay available.
  if (env.SITE_TOPUP_CAPS !== "on") return;
  const [day, week] = await Promise.all([
    topupCentsSince(db, customer.id, new Date(now.getTime() - DAY), now),
    topupCentsSince(db, customer.id, new Date(now.getTime() - 7 * DAY), now),
  ]);
  const allowed = topupAllowance(
    { accountCreatedAt: customer.createdAt, paidLast24hCents: day, paidLastWeekCents: week, status: isStaff(customer.email, env) ? "trusted" : "ok" },
    now,
    holdConfig(env),
  );
  if (cents > allowed) {
    const left = `$${(allowed / 100).toFixed(2).replace(/\.00$/, "")}`;
    const newAccount = now.getTime() - customer.createdAt.getTime() < 7 * DAY;
    refuse(
      new GuardRefused(
        "topup_cap",
        allowed <= 0
          ? newAccount
            ? "New accounts can add a limited amount of Cardbits in their first week. You've reached it for now."
            : "You've reached today's Cardbits purchase limit. Try again tomorrow."
          : `You can add up to ${left} more right now. Choose a smaller package.`,
        403,
      ),
      env,
    );
  }
}

/** Stripe 3D Secure setting for this top-up: "any" (always ask) or "automatic". */
export async function threeDSecureFor(db: Db, customer: { id: string; createdAt: Date }, cents: number, now = new Date()) {
  return threeDSecure({ accountCreatedAt: customer.createdAt, paidTopups: await paidTopups(db, customer.id), cents }, now) as "any" | "automatic";
}

// ---- Shipping review ------------------------------------------------------------------------
/** Shipping waits for staff when a top-up was flagged as risky (see risk.server.ts). */
export async function assertShipAllowed(db: Db, customerId: string, env: NodeJS.ProcessEnv = process.env) {
  const customer = await db.siteCustomer.findUnique({ where: { id: customerId }, select: { riskStatus: true } });
  if (customer?.riskStatus === "review")
    refuse(
      new GuardRefused(
        "ship_hold",
        "Your account is getting a quick security review before cards ship. This usually takes less than a business day, and your cards stay safe in your Vault. Questions? Support@cardbit.com.",
        403,
      ),
      env,
    );
}
