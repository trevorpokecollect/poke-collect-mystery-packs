// Coinflow card checkout for Cardbits top-ups on the standalone site.
// Flow: SiteTopup (PENDING) → Coinflow hosted checkout link → webhook "Settled" credits the
// wallet exactly once (TOPUP + separate BONUS ledger rows). Refunds and chargebacks take the
// Cardbits back as far as the balance allows, record the rest as owed and freeze on chargeback.
// No card data ever touches this app. Keys come from Railway variables only.
import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import type { Prisma, PrismaClient, SiteTopup } from "@prisma/client";
import { applyLedger, balanceOf, TOPUP_PACKAGES } from "../core/ledger.server";
import { siteFundEntries, voidSiteFundEntries } from "../promos/promos.server";
import { clawFounding, settleFounding } from "../waitlist/waitlist.server";
import { assessTopupRisk, sendRiskAlert, type ProcessorRisk, type RiskOutcome } from "./risk.server";

type Tx = Prisma.TransactionClient;
type Env = NodeJS.ProcessEnv;

export class CoinflowError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "CoinflowError";
  }
}

export function coinflowConfigured(env: Env = process.env) {
  return Boolean(env.COINFLOW_API_KEY && env.COINFLOW_API_BASE);
}

/** API root without the /merchant/v2 suffix, e.g. https://api-sandbox.coinflow.cash/api */
export function apiRoot(env: Env = process.env) {
  return (env.COINFLOW_API_BASE || "https://api-sandbox.coinflow.cash/api").replace(/\/+$/, "").replace(/\/merchant(\/v\d+)?$/, "");
}

/** Chargeback-protection device script (Coinflow requires it on every page). */
export function protectionScript(env: Env = process.env) {
  if (env.CARDBIT_SITE !== "on") return "";
  const partner = env.COINFLOW_NSURE_PARTNER_ID || (env.COINFLOW_ENV === "production" ? "" : "COINFTEST");
  const appId = env.COINFLOW_NSURE_APP_ID || "9JBW2RHC7JNJN8ZQ";
  if (!partner) return "";
  const cfg = JSON.stringify({ appId, partnerId: partner }).replace(/</g, "\\u003c");
  return `<script src="https://sdk.nsureapi.com/sdk.js"></script><script>try{window.nSureSDK&&window.nSureSDK.init(${cfg})}catch(e){}</script>`;
}

export function topupPackage(amount: number) {
  const p = TOPUP_PACKAGES[amount];
  return p ? { baseBits: amount, bonusBits: p.bonus, cents: p.cents } : null;
}

export type CheckoutInput = {
  topup: SiteTopup;
  email: string;
  ip: string;
  deviceId?: string | null;
  callbackUrl: string;
};

/** Ask Coinflow for a hosted checkout link for this top-up. */
export async function createCheckoutLink(i: CheckoutInput, env: Env = process.env, fetcher: typeof fetch = fetch) {
  if (!coinflowConfigured(env)) throw new CoinflowError("Card checkout isn't set up yet.");
  const t = i.topup;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    Authorization: env.COINFLOW_API_KEY!,
    "x-coinflow-auth-user-id": t.customerId,
  };
  if (env.COINFLOW_AUTH_BLOCKCHAIN) headers["x-coinflow-auth-blockchain"] = env.COINFLOW_AUTH_BLOCKCHAIN;
  if (i.deviceId) headers["x-device-id"] = i.deviceId.slice(0, 200);
  const total = t.baseBits + t.bonusBits;
  const body: Record<string, unknown> = {
    subtotal: { cents: t.cents, currency: "USD" },
    presentment: "USD",
    email: i.email,
    idempotencyKey: t.id,
    webhookInfo: { topupId: t.id, customerId: t.customerId, kind: "cardbits_topup" },
    standaloneLinkConfig: { callbackUrl: i.callbackUrl, endUserDeviceIpAddress: i.ip },
    chargebackProtectionData: [
      {
        productName: `${total.toLocaleString("en-US")} Cardbits`,
        productType: env.COINFLOW_PRODUCT_TYPE || "topUp",
        quantity: 1,
        rawProductData: { sku: `cardbits-${t.baseBits}`, baseBits: t.baseBits, bonusBits: t.bonusBits },
      },
    ],
  };
  if (env.COINFLOW_SETTLEMENT_TYPE) body.settlementType = env.COINFLOW_SETTLEMENT_TYPE;
  const res = await fetcher(`${apiRoot(env)}/checkout/link`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) {
    // Log status + Coinflow's message only; never the request headers.
    console.error("[site] coinflow checkout link failed", res.status, text.slice(0, 500));
    throw new CoinflowError("Card checkout is unavailable right now. Please try again.", res.status);
  }
  let link: unknown;
  try {
    link = (JSON.parse(text) as { link?: unknown }).link;
  } catch {
    link = null;
  }
  if (typeof link !== "string" || !/^https:\/\//.test(link)) throw new CoinflowError("Coinflow returned no checkout link.");
  return link;
}

// ---- Webhooks -------------------------------------------------------------------------------

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Accepts either the Authorization header (= Webhook Validation Key) or the
 * Coinflow-Signature header (t=<unix>,v1=<hex HMAC-SHA256 of "{t}.{raw}">, 5 min tolerance).
 */
export function verifyWebhook(raw: string, headers: Headers, secret: string | undefined, nowSec = Math.floor(Date.now() / 1000)) {
  if (!secret || secret.length < 16) return false;
  const auth = headers.get("authorization");
  if (auth && (safeEq(auth, secret) || safeEq(auth.replace(/^Bearer\s+/i, ""), secret))) return true;
  const sig = headers.get("coinflow-signature");
  if (!sig) return false;
  const parts = Object.fromEntries(
    sig.split(",").map((p) => {
      const k = p.indexOf("=");
      return [p.slice(0, k).trim(), p.slice(k + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > 300 || !parts.v1) return false;
  const want = createHmac("sha256", secret).update(`${parts.t}.${raw}`).digest("hex");
  return safeEq(want, String(parts.v1).toLowerCase());
}

type Cents = { cents?: number; currency?: string };
export type CoinflowEvent = {
  eventType?: string;
  category?: string;
  created?: string;
  data?: {
    id?: string;
    paymentId?: string;
    refundId?: string;
    chargebackId?: string;
    customerId?: string;
    subtotal?: Cents;
    total?: Cents;
    totals?: { subtotal?: Cents; total?: Cents };
    webhookInfo?: { topupId?: string; customerId?: string } | null;
    /** Processor fraud score when it sends one (Stripe Radar outcome, mapped in stripe-site.server). */
    risk?: ProcessorRisk;
  };
};

export type WebhookDeps = {
  db: PrismaClient;
  /** Called after a top-up is credited (send receipt). Errors are logged, not retried. */
  onCredited?: (topup: SiteTopup, balance: number, email: string) => Promise<void>;
  /** Staff fraud alert (defaults to email). */
  riskAlert?: (topup: SiteTopup, email: string, outcome: RiskOutcome) => Promise<void>;
};

export const eventId = (raw: string) => createHash("sha256").update(raw).digest("hex");

async function lockTopup(tx: Tx, where: { id?: string; paymentId?: string }) {
  const rows = where.id
    ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "SiteTopup" WHERE id = ${where.id} FOR UPDATE`
    : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "SiteTopup" WHERE "paymentId" = ${where.paymentId} FOR UPDATE`;
  return rows.length ? tx.siteTopup.findUniqueOrThrow({ where: { id: rows[0].id } }) : null;
}

/** Take back up to `bits` Cardbits; whatever was already spent is recorded as owed. */
async function clawBack(tx: Tx, t: SiteTopup, bits: number, kind: "REFUND" | "CHARGEBACK", key: string) {
  const prior = await tx.siteLedger.findUnique({ where: { idempotencyKey: key } });
  if (prior) return { taken: -prior.delta, owed: 0, replay: true };
  const balance = await balanceOf(tx, t.customerId);
  const taken = Math.max(0, Math.min(balance, bits));
  if (taken > 0)
    await applyLedger(tx, { customerId: t.customerId, delta: -taken, kind, idempotencyKey: key, ref: t.id, note: `Coinflow ${kind.toLowerCase()}` });
  return { taken, owed: bits - taken, replay: false };
}

/** Process one verified webhook. Returns a short result string for the event log. */
export async function handleCoinflowEvent(deps: WebhookDeps, ev: CoinflowEvent): Promise<string> {
  const { db } = deps;
  const type = ev.eventType || "";
  const d = ev.data || {};

  if (type === "Settled") {
    const topupId = d.webhookInfo?.topupId;
    if (!topupId || !d.id) return "ignored:no_topup";
    let credited: { t: SiteTopup; balance: number; risk: RiskOutcome } | null = null;
    const result = await db.$transaction(async (tx) => {
      const t = await lockTopup(tx, { id: topupId });
      if (!t) return "ignored:unknown_topup";
      if (t.status !== "PENDING") return t.paymentId === d.id ? "replay" : "ignored:already_settled";
      const cents = d.subtotal?.cents;
      const currency = (d.subtotal?.currency || "USD").toUpperCase();
      if (cents !== t.cents || currency !== "USD") {
        console.error("[site] coinflow settled amount mismatch", t.id, cents, currency);
        return "rejected:amount_mismatch";
      }
      if (d.webhookInfo?.customerId && d.webhookInfo.customerId !== t.customerId) return "rejected:customer_mismatch";
      await tx.siteTopup.update({ where: { id: t.id }, data: { status: "CREDITED", paymentId: d.id } });
      await applyLedger(tx, { customerId: t.customerId, delta: t.baseBits, kind: "TOPUP", idempotencyKey: `topup:${t.id}:base`, ref: d.id, note: "Coinflow card top-up" });
      if (t.bonusBits > 0)
        await applyLedger(tx, { customerId: t.customerId, delta: t.bonusBits, kind: "BONUS", idempotencyKey: `topup:${t.id}:bonus`, ref: d.id, note: "Top-up bonus" });
      await siteFundEntries(tx, t.customerId, t.id, t.baseBits); // Daily Giveaway: 1 entry per 100 paid Cardbits
      await settleFounding(tx, t.customerId, { topupId: t.id }); // Founding Collector bonus unlocks with the first top-up
      // Fraud review: a risky payment pauses shipping (or freezes the account) and alerts staff.
      const risk = await assessTopupRisk(tx, t, d.risk);
      credited = { t, balance: await balanceOf(tx, t.customerId), risk };
      return "credited";
    });
    if (credited) {
      const c = credited as { t: SiteTopup; balance: number; risk: RiskOutcome };
      const customer = await db.siteCustomer.findUnique({ where: { id: c.t.customerId } });
      if (customer && deps.onCredited) await deps.onCredited(c.t, c.balance, customer.email).catch((e) => console.error("[site] topup receipt failed", e));
      if (customer) await (deps.riskAlert ?? sendRiskAlert)(c.t, customer.email, c.risk);
    }
    return result;
  }

  if (type === "Refund") {
    const paymentId = d.paymentId || d.id;
    if (!paymentId) return "ignored:no_payment";
    const refundCents = d.totals?.subtotal?.cents ?? d.subtotal?.cents;
    return db.$transaction(async (tx) => {
      const t = await lockTopup(tx, { paymentId });
      if (!t) return "ignored:unknown_payment";
      const full = t.baseBits + t.bonusBits;
      const bits = typeof refundCents === "number" && refundCents < t.cents ? Math.round((full * refundCents) / t.cents) : full;
      const want = Math.max(0, Math.min(bits, full - t.clawedBits));
      if (want === 0) return "replay";
      const r = await clawBack(tx, t, want, "REFUND", `refund:${d.refundId || paymentId}`);
      if (r.replay) return "replay";
      await clawFounding(tx, t, "REFUND");
      await voidSiteFundEntries(tx, t.id);
      await tx.siteTopup.update({
        where: { id: t.id },
        data: { status: "REFUNDED", clawedBits: { increment: r.taken }, owedBits: { increment: r.owed } },
      });
      return r.owed ? `refunded:owed_${r.owed}` : "refunded";
    });
  }

  if (type === "Card Payment Chargeback Opened") {
    const paymentId = d.id || d.paymentId;
    if (!paymentId) return "ignored:no_payment";
    return db.$transaction(async (tx) => {
      const t = await lockTopup(tx, { paymentId });
      if (!t) return "ignored:unknown_payment";
      const want = t.baseBits + t.bonusBits - t.clawedBits;
      const r = want > 0 ? await clawBack(tx, t, want, "CHARGEBACK", `chargeback:${paymentId}`) : { taken: 0, owed: 0, replay: false };
      if (r.replay) return "replay";
      await voidSiteFundEntries(tx, t.id);
      await clawFounding(tx, t, "CHARGEBACK");
      await tx.siteTopup.update({
        where: { id: t.id },
        data: { status: "CHARGEBACK", clawedBits: { increment: r.taken }, owedBits: { increment: r.owed } },
      });
      // Policy: freeze the account on any chargeback; staff reviews and unfreezes.
      await tx.siteCustomer.update({ where: { id: t.customerId }, data: { frozenAt: new Date() } });
      return r.owed ? `chargeback:owed_${r.owed}` : "chargeback";
    });
  }

  if (type === "Card Payment Chargeback Won" || type === "Card Payment Chargeback Lost") {
    const paymentId = d.id || d.paymentId;
    if (!paymentId) return "ignored:no_payment";
    const won = type.endsWith("Won");
    return db.$transaction(async (tx) => {
      const t = await lockTopup(tx, { paymentId });
      if (!t) return "ignored:unknown_payment";
      if (t.status !== "CHARGEBACK") return "replay";
      if (won) {
        const taken = await tx.siteLedger.findUnique({ where: { idempotencyKey: `chargeback:${paymentId}` } });
        if (taken)
          await applyLedger(tx, { customerId: t.customerId, delta: -taken.delta, kind: "CHARGEBACK", idempotencyKey: `chargeback-won:${paymentId}`, ref: t.id, note: "Chargeback won: Cardbits returned" });
        await tx.siteTopup.update({
          where: { id: t.id },
          data: { status: "CHARGEBACK_WON", clawedBits: { decrement: taken ? -taken.delta : 0 }, owedBits: 0 },
        });
        return "chargeback_won"; // account stays frozen until staff review
      }
      await tx.siteTopup.update({ where: { id: t.id }, data: { status: "CHARGEBACK_LOST" } });
      return "chargeback_lost";
    });
  }

  return "logged";
}
