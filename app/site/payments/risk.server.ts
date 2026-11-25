// Fraud review for site top-ups (Trevor, Nov 25 2026: "if something has fraudulent characteristics it
// will alert us", instead of blanket limits). Runs once when a top-up is credited.
//
// Cards only leave Cardbit when they ship, so a risky payment pauses SHIPPING for that account until
// staff clear it on /staff/review. Spending inside the site keeps working. The worst cases also freeze
// the account (no spending or shipping). Every flag emails staff.
//
// Signals: the processor's own risk level (Stripe Radar: elevated / highest), plus ours: brand-new
// account with a big top-up, a big first top-up, connection state ≠ billing state, a device or IP
// shared by several customers, and many top-ups in a day.
import type { Prisma, PrismaClient, SiteTopup } from "@prisma/client";
import { mailerFromEnv, type Mailer } from "../email/mailer.server";
import { staffEmails } from "../shipping/staff.server";

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type ProcessorRisk = { level?: string | null; score?: number | null } | null | undefined;
export type RiskLevel = "normal" | "elevated" | "highest";
export type RiskSignal = { code: string; weight: "strong" | "medium"; detail?: string };

const PAID = ["CREDITED", "CHARGEBACK_WON"];

export async function riskSignals(db: Db, t: SiteTopup, processor: ProcessorRisk, now = new Date()): Promise<RiskSignal[]> {
  const out: RiskSignal[] = [];
  const level = (processor?.level || "").toLowerCase();
  if (level === "highest") out.push({ code: "processor_highest", weight: "strong", detail: `Processor risk: highest${processor?.score != null ? ` (${processor.score})` : ""}` });
  else if (level === "elevated") out.push({ code: "processor_elevated", weight: "medium", detail: `Processor risk: elevated${processor?.score != null ? ` (${processor.score})` : ""}` });

  const customer = await db.siteCustomer.findUnique({ where: { id: t.customerId }, select: { createdAt: true } });
  if (customer && now.getTime() - customer.createdAt.getTime() < DAY && t.cents >= 10_000)
    out.push({ code: "new_account_big", weight: "medium", detail: "Account under a day old, top-up $100+" });

  const priorPaid = await db.siteTopup.count({ where: { customerId: t.customerId, status: { in: PAID }, id: { not: t.id } } });
  if (priorPaid === 0 && t.cents >= 25_000) out.push({ code: "first_topup_big", weight: "medium", detail: "First top-up is $250+" });

  if (t.ipRegion && t.billingState && t.ipRegion.toUpperCase() !== t.billingState.toUpperCase())
    out.push({ code: "state_mismatch", weight: "medium", detail: `Connection in ${t.ipRegion}, billing state ${t.billingState}` });

  if (t.deviceId) {
    const others = await db.siteTopup.findMany({ where: { deviceId: t.deviceId, customerId: { not: t.customerId } }, distinct: ["customerId"], select: { customerId: true } });
    if (others.length >= 2) out.push({ code: "shared_device", weight: "strong", detail: `Device used by ${others.length + 1} accounts` });
  }
  if (t.ip) {
    const others = await db.siteTopup.findMany({
      where: { ip: t.ip, customerId: { not: t.customerId }, createdAt: { gte: new Date(now.getTime() - 30 * DAY) } },
      distinct: ["customerId"],
      select: { customerId: true },
    });
    if (others.length >= 2) out.push({ code: "shared_ip", weight: "medium", detail: `Connection used by ${others.length + 1} accounts this month` });
  }

  const today = await db.siteTopup.count({ where: { customerId: t.customerId, status: { in: PAID }, createdAt: { gte: new Date(now.getTime() - DAY) } } });
  if (today >= 4) out.push({ code: "velocity", weight: "medium", detail: `${today} top-ups in 24 hours` });

  // A chargeback on another account that shared this device is a strong sign.
  if (t.deviceId) {
    const cb = await db.siteTopup.count({ where: { deviceId: t.deviceId, customerId: { not: t.customerId }, status: { in: ["CHARGEBACK", "CHARGEBACK_LOST"] } } });
    if (cb > 0) out.push({ code: "device_chargeback", weight: "strong", detail: "Device linked to a past chargeback" });
  }
  return out;
}

/** highest: any strong signal or 3+ medium. elevated: processor elevated or 2+ medium. */
export function riskLevel(signals: RiskSignal[]): RiskLevel {
  const strong = signals.filter((s) => s.weight === "strong").length;
  const medium = signals.filter((s) => s.weight === "medium").length;
  if (strong > 0 || medium >= 3) return "highest";
  if (medium >= 2 || signals.some((s) => s.code === "processor_elevated")) return "elevated";
  return "normal";
}

export type RiskOutcome = { level: RiskLevel; signals: RiskSignal[]; action: "none" | "review" | "freeze" };

/** Score a just-credited top-up inside the crediting transaction and apply the review/freeze. */
export async function assessTopupRisk(tx: Tx, t: SiteTopup, processor: ProcessorRisk, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<RiskOutcome> {
  const signals = await riskSignals(tx, t, processor, now);
  const level = riskLevel(signals);
  await tx.siteTopup.update({ where: { id: t.id }, data: { riskLevel: level, riskReasons: signals as unknown as Prisma.InputJsonValue } });
  if (level === "normal" || env.SITE_RISK_REVIEW === "off") return { level, signals, action: "none" };
  const customer = await tx.siteCustomer.findUnique({ where: { id: t.customerId }, select: { riskStatus: true, email: true } });
  if (!customer || customer.riskStatus === "trusted" || staffEmails(env).has(customer.email.toLowerCase())) return { level, signals, action: "none" };
  const note = `${level === "highest" ? "High" : "Elevated"} risk top-up ${t.id}: ${signals.map((s) => s.detail || s.code).join("; ")}`.slice(0, 900);
  await tx.siteCustomer.update({
    where: { id: t.customerId },
    data: { riskStatus: "review", riskNote: note, ...(level === "highest" ? { frozenAt: now } : {}) },
  });
  return { level, signals, action: level === "highest" ? "freeze" : "review" };
}

/** Staff alert for a flagged top-up. Never throws. */
export async function sendRiskAlert(t: SiteTopup, email: string, outcome: RiskOutcome, env: NodeJS.ProcessEnv = process.env, mailer: Mailer = mailerFromEnv(env)) {
  if (outcome.action === "none") return;
  const to = (env.SITE_ALERT_EMAILS || env.SITE_STAFF_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean);
  const origin = (env.SITE_ORIGIN || env.CARDBIT_SITE_URL || "").replace(/\/$/, "");
  const what = outcome.action === "freeze" ? "Account frozen (no spending or shipping)" : "Shipping paused for review";
  const lines = outcome.signals.map((s) => `• ${s.detail || s.code}`).join("\n");
  const text = `${what}\n\nCustomer: ${email}\nTop-up: $${(t.cents / 100).toFixed(2)} (${t.provider}) ${t.id}\nRisk: ${outcome.level}\n${lines}\n\nReview: ${origin}/staff/review`;
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  for (const addr of to)
    await mailer
      .send({
        to: addr,
        subject: `Cardbit fraud review: ${email}`,
        text,
        html: `<pre style="font:14px/1.5 system-ui,sans-serif;white-space:pre-wrap">${esc(text)}</pre>`,
        idempotencyKey: `risk-alert:${t.id}:${addr}`,
        tags: { kind: "risk_alert" },
      })
      .catch((e) => console.error("[site] risk alert failed", (e as Error).message));
}
