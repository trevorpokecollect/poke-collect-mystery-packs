// Sales tax economic nexus tracking (Trevor, Nov 25 2026): Cardbit starts with no nexus and collects
// no sales tax, but must know, per state, when sales approach that state's economic nexus threshold so
// it can register and start collecting there. Read-only report + a daily alert email at 70/90/100%.
//
// What counts (conservative, so a threshold is never missed):
// - "Dollars charged": paid top-ups by billing state, plus dollar shipping fees by ship-to state, plus
//   Cardbit Club payments by the member's latest billing state. Refunded and lost-chargeback payments
//   don't count. Each charge is one transaction.
// - "Goods delivered": Poke-Collect retail value of cards shipped to that state (Cardbits ÷ 100), since
//   the physical goods are sourced where they're delivered. Each shipment is one transaction.
// A state's progress is the higher of the two, over the current calendar year, the previous calendar
// year and the trailing 12 months (states measure differently). Thresholds below were current at
// writing (Nov 2026); have the tax adviser confirm before relying on them, and update this table when
// a state changes its rule.
import type { PrismaClient } from "@prisma/client";
import { mailerFromEnv, type Mailer } from "../email/mailer.server";
import { priceKey } from "./stock.server";

export type Threshold = { sales: number | null; txns: number | null; both?: boolean; note?: string };

/** null sales = no statewide sales tax. both = sales AND transactions must be exceeded. */
export const NEXUS: Record<string, Threshold> = {
  AL: { sales: 250_000, txns: null }, AK: { sales: 100_000, txns: null, note: "Remote Seller Sales Tax Commission (local taxes)" },
  AZ: { sales: 100_000, txns: null }, AR: { sales: 100_000, txns: 200 }, CA: { sales: 500_000, txns: null },
  CO: { sales: 100_000, txns: null }, CT: { sales: 100_000, txns: 200, both: true, note: "12 months ending Sept 30" },
  DE: { sales: null, txns: null }, DC: { sales: 100_000, txns: 200 }, FL: { sales: 100_000, txns: null },
  GA: { sales: 100_000, txns: 200 }, HI: { sales: 100_000, txns: 200 }, ID: { sales: 100_000, txns: null },
  IL: { sales: 100_000, txns: null }, IN: { sales: 100_000, txns: null }, IA: { sales: 100_000, txns: null },
  KS: { sales: 100_000, txns: null }, KY: { sales: 100_000, txns: 200 }, LA: { sales: 100_000, txns: null },
  ME: { sales: 100_000, txns: null }, MD: { sales: 100_000, txns: 200 }, MA: { sales: 100_000, txns: null },
  MI: { sales: 100_000, txns: 200 }, MN: { sales: 100_000, txns: 200 }, MS: { sales: 250_000, txns: null, note: "trailing 12 months" },
  MO: { sales: 100_000, txns: null }, MT: { sales: null, txns: null }, NE: { sales: 100_000, txns: 200 },
  NV: { sales: 100_000, txns: 200 }, NH: { sales: null, txns: null }, NJ: { sales: 100_000, txns: 200 },
  NM: { sales: 100_000, txns: null }, NY: { sales: 500_000, txns: 100, both: true, note: "previous four sales tax quarters" },
  NC: { sales: 100_000, txns: null }, ND: { sales: 100_000, txns: null }, OH: { sales: 100_000, txns: 200 },
  OK: { sales: 100_000, txns: null }, OR: { sales: null, txns: null }, PA: { sales: 100_000, txns: null },
  RI: { sales: 100_000, txns: 200 }, SC: { sales: 100_000, txns: null }, SD: { sales: 100_000, txns: null },
  TN: { sales: 100_000, txns: null }, TX: { sales: 500_000, txns: null, note: "trailing 12 months" },
  UT: { sales: 100_000, txns: null }, VT: { sales: 100_000, txns: 200 }, VA: { sales: 100_000, txns: 200 },
  WA: { sales: 100_000, txns: null }, WV: { sales: 100_000, txns: 200 }, WI: { sales: 100_000, txns: null },
  WY: { sales: 100_000, txns: null },
};
export const NEXUS_REVIEWED = "2026-11-25";
/** States where Cardbit blocks purchases (Trevor, Nov 24): tracked anyway, shown as blocked. */
export const BLOCKED_STATES = ["AL", "HI", "ID", "MN", "NV", "NY", "UT", "WA"];
export const BANDS = [70, 90, 100] as const;

type Measure = { cents: number; txns: number };
type Period = { key: string; label: string; from: Date; to: Date };
export type NexusRow = {
  state: string;
  threshold: Threshold;
  blocked: boolean;
  periods: { key: string; label: string; charged: Measure; delivered: Measure; pct: number }[];
  pct: number; // worst (highest) progress across periods and measures, 0-100+
  band: 0 | 70 | 90 | 100;
};

const PAID_TOPUP = ["CREDITED", "CHARGEBACK_WON"];
const ST = (v: unknown) => (typeof v === "string" && /^[A-Za-z]{2}$/.test(v.trim()) ? v.trim().toUpperCase() : null);

export function periodsAt(now = new Date()): Period[] {
  const y = now.getUTCFullYear();
  return [
    { key: String(y), label: `${y} so far`, from: new Date(Date.UTC(y, 0, 1)), to: now },
    { key: String(y - 1), label: String(y - 1), from: new Date(Date.UTC(y - 1, 0, 1)), to: new Date(Date.UTC(y, 0, 1)) },
    { key: "ttm", label: "Last 12 months", from: new Date(now.getTime() - 365 * 86_400_000), to: now },
  ];
}

/** Progress toward a threshold, in % (both = the lower of the two must pass). */
export function progress(t: Threshold, m: Measure): number {
  if (t.sales == null) return 0;
  const s = (m.cents / 100 / t.sales) * 100;
  if (t.txns == null) return s;
  const n = (m.txns / t.txns) * 100;
  return t.both ? Math.min(s, n) : Math.max(s, n);
}
export const bandOf = (pct: number): NexusRow["band"] => (pct >= 100 ? 100 : pct >= 90 ? 90 : pct >= 70 ? 70 : 0);

type Charge = { state: string | null; cents: number; at: Date };

/** Every counted charge and delivery since `from`. */
async function facts(db: PrismaClient, from: Date) {
  const [topups, shipments, subPays] = await Promise.all([
    db.siteTopup.findMany({ where: { status: { in: PAID_TOPUP }, createdAt: { gte: from } }, select: { billingState: true, cents: true, createdAt: true, customerId: true } }),
    db.siteShipment.findMany({
      where: { status: { notIn: ["DRAFT", "CANCELED"] }, createdAt: { gte: from } },
      select: { toAddress: true, feeCents: true, createdAt: true, shippedAt: true, status: true, items: { select: { copyId: true } } },
    }),
    db.siteSubscriptionPayment.findMany({ where: { status: "CREDITED", createdAt: { gte: from } }, select: { customerId: true, cents: true, createdAt: true } }),
  ]);
  // Club payments: the member's latest known billing state.
  const subIds = [...new Set(subPays.map((p) => p.customerId))];
  const lastState = new Map<string, string>();
  if (subIds.length) {
    const rows = await db.siteTopup.findMany({ where: { customerId: { in: subIds } }, orderBy: { createdAt: "asc" }, select: { customerId: true, billingState: true } });
    for (const r of rows) if (ST(r.billingState)) lastState.set(r.customerId, ST(r.billingState)!);
  }
  const charges: Charge[] = [
    ...topups.map((t) => ({ state: ST(t.billingState), cents: t.cents, at: t.createdAt })),
    ...shipments.filter((s) => s.feeCents > 0).map((s) => ({ state: ST((s.toAddress as { state?: string } | null)?.state), cents: s.feeCents, at: s.createdAt })),
    ...subPays.map((p) => ({ state: lastState.get(p.customerId) ?? null, cents: p.cents, at: p.createdAt })),
  ];
  // Goods delivered: retail of the shipped cards (copy price at sale, else the current site price).
  const shipped = shipments.filter((s) => ["LABEL_PURCHASED", "IN_TRANSIT", "DELIVERED", "PAID"].includes(s.status));
  const copyIds = shipped.flatMap((s) => s.items.map((i) => i.copyId));
  const copies = copyIds.length ? await db.siteCopy.findMany({ where: { id: { in: copyIds } }, select: { id: true, retailBits: true, printingKey: true, condition: true } }) : [];
  const keys = [...new Set(copies.map((c) => priceKey(c.printingKey, c.condition)))];
  const prices = new Map((keys.length ? await db.sitePrice.findMany({ where: { printingKey: { in: keys } } }) : []).map((p) => [p.printingKey, p.retailBits ?? 0]));
  const value = new Map(copies.map((c) => [c.id, c.retailBits ?? prices.get(priceKey(c.printingKey, c.condition)) ?? 0]));
  const deliveries: Charge[] = shipped.map((s) => ({
    state: ST((s.toAddress as { state?: string } | null)?.state),
    cents: s.items.reduce((n, i) => n + (value.get(i.copyId) ?? 0), 0), // 100 Cardbits = $1, so Cardbits = cents
    at: s.shippedAt ?? s.createdAt,
  }));
  return { charges, deliveries };
}

export async function nexusReport(db: PrismaClient, now = new Date()) {
  const periods = periodsAt(now);
  const from = new Date(Math.min(...periods.map((p) => p.from.getTime())));
  const { charges, deliveries } = await facts(db, from);
  const sum = (list: Charge[], st: string, p: Period): Measure => {
    let cents = 0, txns = 0;
    for (const c of list) if (c.state === st && c.at >= p.from && c.at < p.to) (cents += c.cents), txns++;
    return { cents, txns };
  };
  const rows: NexusRow[] = Object.entries(NEXUS).map(([state, threshold]) => {
    const ps = periods.map((p) => {
      const charged = sum(charges, state, p), delivered = sum(deliveries, state, p);
      return { key: p.key, label: p.label, charged, delivered, pct: Math.max(progress(threshold, charged), progress(threshold, delivered)) };
    });
    const pct = Math.max(0, ...ps.map((p) => p.pct));
    return { state, threshold, blocked: BLOCKED_STATES.includes(state), periods: ps, pct: Math.round(pct * 10) / 10, band: bandOf(pct) };
  });
  rows.sort((a, b) => b.pct - a.pct || a.state.localeCompare(b.state));
  const unknown = charges.filter((c) => !c.state).reduce((n, c) => n + c.cents, 0);
  return { reviewed: NEXUS_REVIEWED, generatedAt: now.toISOString(), rows, unknownStateCents: unknown, collecting: [] as string[] };
}

/** Emails staff once per state, band and year when a state reaches 70%, 90% or 100% of its threshold. */
export async function runNexusAlerts(db: PrismaClient, env: NodeJS.ProcessEnv = process.env, mailer: Mailer = mailerFromEnv(env), now = new Date()) {
  const report = await nexusReport(db, now);
  const year = String(now.getUTCFullYear());
  const fresh: NexusRow[] = [];
  for (const r of report.rows) {
    if (!r.band) continue;
    const id = `${r.state}:${r.band}:${year}`;
    const created = await db.siteNexusAlert.createMany({ data: [{ id, state: r.state, band: r.band, period: year }], skipDuplicates: true });
    if (created.count) fresh.push(r);
  }
  if (!fresh.length) return { sent: 0, report };
  const to = (env.SITE_NEXUS_ALERT_EMAILS || env.SITE_ALERT_EMAILS || env.SITE_STAFF_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean);
  const line = (r: NexusRow) =>
    `• ${r.state}: ${r.pct}% of the ${r.threshold.sales ? `$${r.threshold.sales.toLocaleString("en-US")}` : ""}${r.threshold.txns ? ` ${r.threshold.both ? "and" : "or"} ${r.threshold.txns} transactions` : ""} threshold${r.band >= 100 ? " — REACHED: register and start collecting sales tax there" : ""}${r.blocked ? " (purchases from this state are blocked)" : ""}`;
  const text = `Sales tax nexus update for Cardbit.\n\n${fresh.map(line).join("\n")}\n\nSee Card Broker → Analytics → Sales Tax for the details. Thresholds last reviewed ${report.reviewed}; confirm with your tax adviser before registering.`;
  for (const addr of to)
    await mailer
      .send({ to: addr, subject: `Cardbit: sales tax nexus alert (${fresh.map((r) => r.state).join(", ")})`, text, html: `<pre style="font:14px/1.5 system-ui,sans-serif;white-space:pre-wrap">${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre>`, idempotencyKey: `nexus:${fresh.map((r) => `${r.state}${r.band}`).join("-")}:${year}:${addr}`, tags: { kind: "nexus_alert" } })
      .catch((e) => console.error("[site-nexus] alert failed", (e as Error).message));
  return { sent: fresh.length, report };
}

let timer: ReturnType<typeof setInterval> | undefined;
let lastDay = "";
/** Once a day at 6 AM Central or later (checked hourly). Production only; SITE_NEXUS_ALERTS=off disables it. */
export function startNexusClock(db: PrismaClient) {
  if (timer || process.env.CARDBIT_SITE !== "on" || process.env.NODE_ENV !== "production" || process.env.SITE_NEXUS_ALERTS === "off") return;
  const tick = () => {
    const now = new Date();
    const ctDay = now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const ctHour = Number(now.toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }));
    if (ctDay === lastDay || ctHour < 6) return;
    lastDay = ctDay;
    void runNexusAlerts(db).catch((e) => console.error("[site-nexus] check failed", (e as Error).message));
  };
  timer = setInterval(tick, 3_600_000);
  timer.unref();
}
