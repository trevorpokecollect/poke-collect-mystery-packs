// Server side of the Cardbit bot and fraud guard: rate limits per signed-in customer, Turnstile
// checks, risk profiles, shared device/card detection, shipping holds and top-up limits.
// Rules are in cardbit-guard.ts. Everything is off for other stores and logs-only until
// CARDBIT_GUARD=on, so deploying this changes nothing customers see.
import { createHmac } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { isCardbit } from "./cardbit.server";
import {
  RATE_LIMITS,
  SHARED_LIMIT,
  formatOpens,
  guardMode,
  holdConfig,
  shipOpensAt,
  statusAllows,
  threeDSecure,
  topupAllowance,
  turnstileActions,
  type GuardAction,
  type RiskReason,
  type RiskStatus,
} from "./cardbit-guard";

type Db = PrismaClient | Prisma.TransactionClient;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function secret(env = process.env) {
  return env.CARDBIT_GUARD_SECRET || env.SHOPIFY_API_SECRET || "dev-only-guard-secret";
}

/** Raw device ids and card fingerprints are never stored, only keyed hashes. */
export const keyedHash = (value: string, env = process.env) =>
  createHmac("sha256", secret(env)).update(value).digest("hex").slice(0, 32);

const asStatus = (s: string | null | undefined): RiskStatus =>
  s === "review" || s === "blocked" || s === "trusted" ? s : "ok";

export function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function logEvent(
  db: Db,
  shop: string,
  customerId: string | null,
  action: string,
  rule: string,
  detail: string | null,
  enforced: boolean,
) {
  await db.cardbitGuardEvent
    .create({ data: { shop, customerId, action, rule, detail: detail?.slice(0, 500) ?? null, enforced } })
    .catch((error) => console.error("Cardbit guard event not saved", error));
}

// ---------- rate limits ----------

/** Counts this request and returns the limit it broke, if any. */
export async function rateLimitHit(db: Db, key: string, limits: { perMinute: number; perHour: number }, now = new Date()) {
  await db.rateLimitHit.create({ data: { key } });
  const [minute, hour] = await Promise.all([
    db.rateLimitHit.count({ where: { key, createdAt: { gte: new Date(now.getTime() - MINUTE) } } }),
    db.rateLimitHit.count({ where: { key, createdAt: { gte: new Date(now.getTime() - HOUR) } } }),
  ]);
  // Keep the table small without a separate job.
  if (Math.random() < 0.01)
    await db.rateLimitHit
      .deleteMany({ where: { key: { startsWith: "cb:" }, createdAt: { lt: new Date(now.getTime() - 2 * HOUR) } } })
      .catch(() => {});
  if (minute > limits.perMinute) return "minute";
  if (hour > limits.perHour) return "hour";
  return null;
}

// ---------- Turnstile ----------

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const HOSTNAMES = new Set(["cardbit.com", "www.cardbit.com", "hhuuev-81.myshopify.com"]);

/** Token from the theme: header X-Cardbit-Turnstile, or ?cbt= (app proxy always forwards the query). */
export function turnstileToken(request: Request) {
  return request.headers.get("x-cardbit-turnstile") || new URL(request.url).searchParams.get("cbt") || null;
}

export async function verifyTurnstile(
  token: string | null,
  env = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; reason: string }> {
  const key = env.CARDBIT_TURNSTILE_SECRET_KEY;
  if (!key) return { ok: true, reason: "not-configured" };
  if (!token || token.length > 2048) return { ok: false, reason: "missing-token" };
  try {
    const res = await fetchImpl(SITEVERIFY, {
      method: "POST",
      body: new URLSearchParams({ secret: key, response: token }),
      signal: AbortSignal.timeout(5000),
    });
    const body = (await res.json()) as { success?: boolean; hostname?: string; "error-codes"?: string[] };
    if (!body.success) return { ok: false, reason: (body["error-codes"] ?? ["failed"]).join(",") };
    if (body.hostname && !HOSTNAMES.has(body.hostname)) return { ok: false, reason: "hostname:" + body.hostname };
    return { ok: true, reason: "passed" };
  } catch {
    // Cloudflare unreachable: let the person through rather than lock everyone out; it is logged.
    return { ok: true, reason: "siteverify-unreachable" };
  }
}

// ---------- risk profiles ----------

export async function riskProfile(db: Db, shop: string, customerId: string, admin?: AdminApiContext | null) {
  let profile = await db.cardbitRiskProfile.upsert({
    where: { shop_customerId: { shop, customerId } },
    create: { shop, customerId },
    update: {},
  });
  if (!profile.accountCreatedAt && admin) {
    const createdAt = await shopifyCustomerCreatedAt(admin, customerId);
    if (createdAt)
      profile = await db.cardbitRiskProfile.update({
        where: { shop_customerId: { shop, customerId } },
        data: { accountCreatedAt: createdAt },
      });
  }
  return { ...profile, status: asStatus(profile.status) };
}

async function shopifyCustomerCreatedAt(admin: AdminApiContext, customerId: string) {
  try {
    const res = await admin.graphql(`#graphql
      query GuardCustomer($id: ID!) { customer(id: $id) { createdAt } }`, { variables: { id: customerId } });
    const body = (await res.json()) as { data?: { customer?: { createdAt?: string } | null } };
    const at = body.data?.customer?.createdAt;
    return at ? new Date(at) : null;
  } catch {
    return null;
  }
}

/**
 * Puts an account up for staff review (or blocks it) and records why. A blocked account stays
 * blocked, and an account staff marked trusted only moves when the new status is "blocked".
 */
export async function flagCustomer(
  db: Db,
  shop: string,
  customerId: string,
  code: string,
  detail: string | undefined,
  status: "review" | "blocked" = "review",
  now = new Date(),
) {
  const current = await db.cardbitRiskProfile.upsert({
    where: { shop_customerId: { shop, customerId } },
    create: { shop, customerId },
    update: {},
  });
  const reasons = (Array.isArray(current.reasons) ? current.reasons : []) as RiskReason[];
  const was = asStatus(current.status);
  const next: RiskStatus =
    was === "blocked" || status === "blocked" ? "blocked" : was === "trusted" ? "trusted" : "review";
  const updated = await db.cardbitRiskProfile.update({
    where: { shop_customerId: { shop, customerId } },
    data: {
      status: next,
      reasons: [...reasons, { code, ...(detail ? { detail } : {}), at: now.toISOString() }].slice(-50),
    },
  });
  if (next !== was) console.warn(`Cardbit guard: ${customerId} ${was} → ${next} (${code})`);
  return { ...updated, status: next };
}

/** Staff decision from the review page. */
export async function setRiskStatus(
  db: Db,
  shop: string,
  customerId: string,
  status: RiskStatus,
  staff: string,
  note?: string,
  now = new Date(),
) {
  return db.cardbitRiskProfile.upsert({
    where: { shop_customerId: { shop, customerId } },
    create: { shop, customerId, status, reviewedBy: staff, reviewedAt: now, note: note ?? null },
    update: { status, reviewedBy: staff, reviewedAt: now, ...(note !== undefined ? { note } : {}) },
  });
}

/**
 * Records a device id or payment-card fingerprint for a customer. When more distinct customers
 * than SHARED_LIMIT share it, every one of them goes to review.
 */
export async function recordSignal(db: Db, shop: string, customerId: string, kind: "device" | "card", raw: string) {
  const value = raw.trim();
  if (!value || value.length > 256) return;
  const valueHash = keyedHash(kind + ":" + value);
  await db.cardbitRiskSignal
    .upsert({
      where: { shop_kind_valueHash_customerId: { shop, kind, valueHash, customerId } },
      create: { shop, customerId, kind, valueHash },
      update: {},
    })
    .catch(() => {});
  const sharing = await db.cardbitRiskSignal.findMany({
    where: { shop, kind, valueHash },
    select: { customerId: true },
    distinct: ["customerId"],
    take: 50,
  });
  if (sharing.length <= SHARED_LIMIT[kind]) return;
  const detail = `${sharing.length} accounts share one ${kind === "card" ? "payment card" : "device"}`;
  for (const row of sharing) {
    const profile = await db.cardbitRiskProfile.findUnique({
      where: { shop_customerId: { shop, customerId: row.customerId } },
      select: { status: true, reasons: true },
    });
    const already = ((profile?.reasons ?? []) as RiskReason[]).some((r) => r.code === `shared-${kind}` && r.detail === detail);
    if (!already) await flagCustomer(db, shop, row.customerId, `shared-${kind}`, detail);
  }
}

/** Device id from the theme: header X-Cardbit-Device, or ?cbd=. A random id kept in the browser. */
export function deviceId(request: Request) {
  const raw = request.headers.get("x-cardbit-device") || new URL(request.url).searchParams.get("cbd");
  return raw && /^[A-Za-z0-9_-]{16,64}$/.test(raw) ? raw : null;
}

// ---------- the gate each route calls ----------

export type GuardContext = {
  db: Db;
  shop: string;
  customerId: string | null | undefined;
  action: GuardAction;
  admin?: AdminApiContext | null;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  fetchImpl?: typeof fetch;
};

/**
 * Runs the guard for one customer request. Returns a Response to send back when the request is
 * refused, or null to carry on. In "log" mode it records what it would refuse and returns null.
 */
export async function guardRequest(request: Request, ctx: GuardContext): Promise<Response | null> {
  const env = ctx.env ?? process.env;
  const mode = guardMode(env);
  if (mode === "off" || !isCardbit(ctx.shop, env) || !ctx.customerId) return null;
  const { db, shop, action } = ctx;
  const customerId = ctx.customerId;
  const enforce = mode === "on";
  const refuse = async (rule: string, detail: string | null, response: Response) => {
    await logEvent(db, shop, customerId, action, rule, detail, enforce);
    return enforce ? response : null;
  };
  try {
    const limited = await rateLimitHit(db, `cb:${action}:${customerId}`, RATE_LIMITS[action], ctx.now);
    if (limited)
      return await refuse("rate-limit", limited, json({ error: "Too many tries. Wait a minute and try again." }, 429));

    const device = deviceId(request);
    if (device) await recordSignal(db, shop, customerId, "device", device);

    const profile = await riskProfile(db, shop, customerId, ctx.admin);
    if (!statusAllows(profile.status, action))
      return await refuse(
        "account-" + profile.status,
        null,
        json(
          {
            error:
              profile.status === "blocked"
                ? "This account is paused. Contact support@cardbit.com."
                : "Your account is under a quick security review. Contact support@cardbit.com if it takes more than a day.",
            review: true,
          },
          403,
        ),
      );

    if (turnstileActions(env).has(action)) {
      const check = await verifyTurnstile(turnstileToken(request), env, ctx.fetchImpl);
      if (!check.ok)
        return await refuse(
          "turnstile",
          check.reason,
          json({ error: "Confirm you're human, then try again.", challenge: true }, 403),
        );
    }

    if (env.CARDBIT_REQUIRE_PHONE === "on" && ["spin", "spark-shop", "giveaway"].includes(action) && !profile.phoneVerifiedAt)
      return await refuse("phone", null, json({ error: "Verify your phone number to claim free rewards.", phone: true }, 403));
  } catch (error) {
    // The guard must never take the store down with it.
    console.error("Cardbit guard failed open", error);
  }
  return null;
}

// ---------- shipping and top-ups ----------

async function paidTopups(db: Db, shop: string, customerId: string, now: Date) {
  const rows = await db.cardbitReceipt.findMany({
    where: { shop, customerId, kind: "topup", qualifyingPaidCents: { gt: 0 } },
    select: { qualifyingPaidCents: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const since = (ms: number) =>
    rows.filter((r) => r.createdAt.getTime() > now.getTime() - ms).reduce((n, r) => n + r.qualifyingPaidCents, 0);
  return {
    count: rows.length,
    last: rows[0]?.createdAt ?? null,
    last24h: since(24 * HOUR),
    lastWeek: since(7 * 24 * HOUR),
  };
}

/**
 * Shipping hold for new accounts and fresh top-ups. Returns the refusal Response, or null.
 * Logged (not enforced) while CARDBIT_GUARD=log.
 */
export async function shipHold(
  db: Db,
  shop: string,
  customerId: string,
  admin?: AdminApiContext | null,
  env = process.env,
  now = new Date(),
) {
  const mode = guardMode(env);
  if (mode === "off" || !isCardbit(shop, env)) return null;
  try {
    const profile = await riskProfile(db, shop, customerId, admin);
    const topups = await paidTopups(db, shop, customerId, now);
    const opens = shipOpensAt(
      { accountCreatedAt: profile.accountCreatedAt, lastPaidTopupAt: topups.last, status: profile.status },
      now,
      holdConfig(env),
    );
    if (!opens) return null;
    await logEvent(db, shop, customerId, "ship", "ship-hold", opens.toISOString(), mode === "on");
    if (mode !== "on") return null;
    return json(
      {
        error: `For your security, shipping opens ${formatOpens(opens)}. Your cards stay safe in your Vault until then.`,
        shipOpensAt: opens.toISOString(),
      },
      403,
    );
  } catch (error) {
    console.error("Cardbit ship hold failed open", error);
    return null;
  }
}

/**
 * Whether a top-up of `cents` may start, and the 3D Secure setting to use for it.
 * The top-up checkout calls this before creating a payment.
 */
export async function topupCheck(
  db: Db,
  shop: string,
  customerId: string,
  cents: number,
  admin?: AdminApiContext | null,
  env = process.env,
  now = new Date(),
): Promise<{ allowed: boolean; maxCents: number; threeDSecure: "any" | "automatic"; message?: string }> {
  const profile = await riskProfile(db, shop, customerId, admin);
  const topups = await paidTopups(db, shop, customerId, now);
  const maxCents = topupAllowance(
    {
      accountCreatedAt: profile.accountCreatedAt,
      paidLast24hCents: topups.last24h,
      paidLastWeekCents: topups.lastWeek,
      status: profile.status,
    },
    now,
    holdConfig(env),
  );
  const tds = threeDSecure({ accountCreatedAt: profile.accountCreatedAt, paidTopups: topups.count, cents }, now);
  const mode = guardMode(env);
  if (cents <= maxCents || mode === "off" || !isCardbit(shop, env)) return { allowed: true, maxCents, threeDSecure: tds };
  await logEvent(db, shop, customerId, "topup", "topup-limit", `${cents} > ${maxCents}`, mode === "on");
  const message =
    maxCents <= 0
      ? "You've reached today's top-up limit. Try again tomorrow."
      : `New accounts can add up to $${(maxCents / 100).toFixed(2)} right now. Choose a smaller package.`;
  return { allowed: mode !== "on", maxCents, threeDSecure: tds, message };
}

/**
 * Stripe Radar early fraud warning or a dispute on a top-up: pause the account for review.
 * The top-up webhook calls this alongside holding the wallet.
 */
export async function flagPaymentRisk(db: Db, shop: string, customerId: string, code: string, detail?: string) {
  if (!isCardbit(shop)) return;
  await flagCustomer(db, shop, customerId, code, detail);
}

/** Shopify's fraud analysis on a paid Cardbit order. HIGH risk goes to review. */
export async function checkOrderRisk(db: Db, admin: AdminApiContext, shop: string, orderId: string, customerId: string | null) {
  if (!isCardbit(shop) || !customerId || guardMode() === "off") return null;
  try {
    const res = await admin.graphql(`#graphql
      query GuardOrderRisk($id: ID!) { order(id: $id) { risk { recommendation assessments { riskLevel } } } }`, {
      variables: { id: orderId },
    });
    const body = (await res.json()) as {
      data?: { order?: { risk?: { recommendation?: string; assessments?: { riskLevel?: string }[] } } | null };
    };
    const risk = body.data?.order?.risk;
    const high = risk?.recommendation === "CANCEL" || !!risk?.assessments?.some((a) => a.riskLevel === "HIGH");
    if (high) await flagCustomer(db, shop, customerId, "order-high-risk", orderId);
    return high ? "high" : (risk?.recommendation?.toLowerCase() ?? null);
  } catch (error) {
    console.error("Cardbit order risk check failed", error);
    return null;
  }
}

/** For the staff review page. */
export async function reviewQueue(db: Db, shop: string) {
  const [profiles, events] = await Promise.all([
    db.cardbitRiskProfile.findMany({
      where: { shop, OR: [{ status: { in: ["review", "blocked"] } }, { reviewedAt: { not: null } }] },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    db.cardbitGuardEvent.groupBy({
      by: ["rule", "enforced"],
      where: { shop, createdAt: { gte: new Date(Date.now() - 7 * 24 * HOUR) } },
      _count: { _all: true },
    }),
  ]);
  return { profiles, events };
}
