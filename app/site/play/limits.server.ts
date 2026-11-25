// Responsible-play controls for the standalone site: Top-Up Limits ($), Spend Limits (packs + singles)
// (Cardbits), Cool-Off and Self-Exclusion.
//
// Rules (Trevor, Nov 24 2026; modeled on Boxed.gg's self-exclusion plus common safer-play norms):
// - Lowering or adding a limit applies at once. Raising or removing one waits 24 hours, so a limit
//   can't be undone in the moment.
// - Cool-Off (24h, 72h, 7d, 30d) and Self-Exclusion (6 months, 1 year, 5 years) pause top-ups,
//   pack purchases, single purchases, Daily Spins and subscriptions. They can't be shortened or
//   canceled early. During a pause the customer can still sign in, view the Vault, ship cards and
//   sell cards back.
// - Limits are rolling windows: day = last 24h, week = last 7 days, month = last 30 days.
// - Every change writes a SitePlayEvent for audit.
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export const PERIODS = ["day", "week", "month"] as const;
export type Period = (typeof PERIODS)[number];
export const KINDS = ["topup", "spend"] as const;
export type LimitKind = (typeof KINDS)[number];
export type LimitKey = `${LimitKind}:${Period}`;
export type Limits = Partial<Record<LimitKey, number>>;

export const PERIOD_MS: Record<Period, number> = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 };
export const RAISE_DELAY_MS = 86_400_000;
export const COOL_OFF_HOURS = [24, 72, 168, 720] as const;
export const EXCLUSION_MONTHS = [6, 12, 60] as const;
/** Max a limit can be set to: $10,000 per window for top-ups; 1,000,000 Cardbits for spend. */
const MAX: Record<LimitKind, number> = { topup: 1_000_000, spend: 1_000_000 };
/** An unpaid checkout still counts toward the top-up limit for this long. */
const PENDING_TOPUP_MS = 2 * 3_600_000;

export class PlayPaused extends Error {
  readonly code = "play_paused";
  constructor(readonly kind: "cool_off" | "self_exclusion", readonly until: Date) {
    super(
      kind === "self_exclusion"
        ? `Your self-exclusion is active until ${fmtDate(until)}. You can still view your Vault, ship cards and sell cards back.`
        : `Your cool-off is active until ${fmtDate(until)}. You can still view your Vault, ship cards and sell cards back.`,
    );
    this.name = "PlayPaused";
  }
}

export class LimitReached extends Error {
  readonly code = "limit_reached";
  constructor(readonly key: LimitKey, readonly limit: number, readonly used: number) {
    const [kind, period] = key.split(":") as [LimitKind, Period];
    const label = period === "day" ? "daily" : period === "week" ? "weekly" : "monthly";
    super(
      kind === "topup"
        ? `This would go over your ${label} Top-Up Limit of ${usd(limit)} (${usd(Math.max(limit - used, 0))} left).`
        : `This would go over your ${label} Spend Limit of ${bits(limit)} Cardbits (${bits(Math.max(limit - used, 0))} left).`,
    );
    this.name = "LimitReached";
  }
}

export class PlayInputError extends Error {
  readonly code = "invalid";
}

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const bits = (n: number) => n.toLocaleString("en-US");
export const fmtDate = (d: Date) =>
  d.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) + " CT";

function cleanLimits(raw: unknown): Limits {
  const out: Limits = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of KINDS)
    for (const p of PERIODS) {
      const v = (raw as Record<string, unknown>)[`${k}:${p}`];
      if (Number.isInteger(v) && (v as number) >= 0) out[`${k}:${p}`] = v as number;
    }
  return out;
}

type Pending = { key: LimitKey; value: number | null; at: string }[];
function cleanPending(raw: unknown): Pending {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x) => x && typeof x.key === "string" && /^(topup|spend):(day|week|month)$/.test(x.key) && (x.value === null || Number.isInteger(x.value)) && typeof x.at === "string",
  );
}

export type PlayControl = {
  limits: Limits;
  pending: Pending;
  coolOffUntil: Date | null;
  excludedUntil: Date | null;
};

/** Read controls, applying any raised/removed limits whose 24h wait has passed. */
export async function playControl(db: Db, customerId: string, now = new Date()): Promise<PlayControl> {
  const row = await db.sitePlayControl.findUnique({ where: { customerId } });
  if (!row) return { limits: {}, pending: [], coolOffUntil: null, excludedUntil: null };
  const limits = cleanLimits(row.limits);
  const pending = cleanPending(row.pending);
  const due = pending.filter((p) => new Date(p.at) <= now);
  if (due.length) {
    for (const p of due) {
      if (p.value === null) delete limits[p.key];
      else limits[p.key] = p.value;
    }
    const left = pending.filter((p) => new Date(p.at) > now);
    await db.sitePlayControl.update({ where: { customerId }, data: { limits, pending: left } });
    for (const p of due) await logEvent(db, customerId, "limit_applied", { key: p.key, value: p.value });
    return { limits, pending: left, coolOffUntil: row.coolOffUntil, excludedUntil: row.excludedUntil };
  }
  return { limits, pending, coolOffUntil: row.coolOffUntil, excludedUntil: row.excludedUntil };
}

export function activePause(c: Pick<PlayControl, "coolOffUntil" | "excludedUntil">, now = new Date()) {
  if (c.excludedUntil && c.excludedUntil > now) return { kind: "self_exclusion" as const, until: c.excludedUntil };
  if (c.coolOffUntil && c.coolOffUntil > now) return { kind: "cool_off" as const, until: c.coolOffUntil };
  return null;
}

/** Throws PlayPaused during a cool-off or self-exclusion. */
export async function assertNotPaused(db: Db, customerId: string, now = new Date()) {
  const row = await db.sitePlayControl.findUnique({ where: { customerId }, select: { coolOffUntil: true, excludedUntil: true } });
  const p = row && activePause(row, now);
  if (p) throw new PlayPaused(p.kind, p.until);
}

async function logEvent(db: Db, customerId: string, kind: string, detail: Record<string, unknown>) {
  await db.sitePlayEvent.create({ data: { customerId, kind, detail: detail as Prisma.InputJsonValue } });
}

type RowData = { limits?: Limits; pending?: Pending; coolOffUntil?: Date; excludedUntil?: Date };
async function upsertRow(db: Db, customerId: string, data: RowData) {
  const d = data as Prisma.InputJsonObject & RowData;
  await db.sitePlayControl.upsert({ where: { customerId }, create: { customerId, ...d }, update: d });
}

/**
 * Set (value) or remove (null) one limit. Tighter = immediate; looser = after 24 hours.
 * Returns whether the change applied now or when it will.
 */
export async function setLimit(db: Db, customerId: string, key: LimitKey, value: number | null, now = new Date()) {
  const [kind, period] = key.split(":") as [LimitKind, Period];
  if (!KINDS.includes(kind) || !PERIODS.includes(period)) throw new PlayInputError("Choose a limit.");
  if (value !== null && (!Number.isInteger(value) || value < 100 || value > MAX[kind]))
    throw new PlayInputError(kind === "topup" ? "Enter a limit from $1 to $10,000." : "Enter a limit from 100 to 1,000,000 Cardbits.");
  const c = await playControl(db, customerId, now);
  const current = c.limits[key];
  const pending = c.pending.filter((p) => p.key !== key);
  const tighter = value !== null && (current === undefined || value <= current);
  if (tighter) {
    const limits = { ...c.limits, [key]: value };
    await upsertRow(db, customerId, { limits, pending });
    await logEvent(db, customerId, "limit_set", { key, value, from: current ?? null });
    return { applied: true as const, at: now };
  }
  if (value === null && current === undefined) {
    await upsertRow(db, customerId, { limits: c.limits, pending });
    return { applied: true as const, at: now };
  }
  const at = new Date(now.getTime() + RAISE_DELAY_MS);
  pending.push({ key, value, at: at.toISOString() });
  await upsertRow(db, customerId, { limits: c.limits, pending });
  await logEvent(db, customerId, "limit_raise_requested", { key, value, from: current ?? null, at: at.toISOString() });
  return { applied: false as const, at };
}

/** Cancel a waiting raise/removal (keeps the current, tighter limit). */
export async function cancelPending(db: Db, customerId: string, key: LimitKey, now = new Date()) {
  const c = await playControl(db, customerId, now);
  if (!c.pending.some((p) => p.key === key)) return;
  await upsertRow(db, customerId, { limits: c.limits, pending: c.pending.filter((p) => p.key !== key) });
  await logEvent(db, customerId, "limit_raise_canceled", { key });
}

/** Start a cool-off. A longer pause already running is never shortened. */
export async function startCoolOff(db: Db, customerId: string, hours: number, now = new Date()) {
  if (!(COOL_OFF_HOURS as readonly number[]).includes(hours)) throw new PlayInputError("Choose a cool-off length.");
  const until = new Date(now.getTime() + hours * 3_600_000);
  const c = await playControl(db, customerId, now);
  const next = c.coolOffUntil && c.coolOffUntil > until ? c.coolOffUntil : until;
  await upsertRow(db, customerId, { coolOffUntil: next });
  await logEvent(db, customerId, "cool_off", { hours, until: next.toISOString() });
  return next;
}

/** Start a self-exclusion (months). Can't be shortened; a longer one already running stays. */
export async function selfExclude(db: Db, customerId: string, months: number, now = new Date()) {
  if (!(EXCLUSION_MONTHS as readonly number[]).includes(months)) throw new PlayInputError("Choose a self-exclusion length.");
  const until = new Date(now);
  until.setUTCMonth(until.getUTCMonth() + months);
  const c = await playControl(db, customerId, now);
  const next = c.excludedUntil && c.excludedUntil > until ? c.excludedUntil : until;
  await upsertRow(db, customerId, { excludedUntil: next });
  await logEvent(db, customerId, "self_exclusion", { months, until: next.toISOString() });
  return next;
}

/** Top-up dollars (cents) in the window: credited payments plus checkouts started in the last 2 hours. */
export async function topupCentsSince(db: Db, customerId: string, since: Date, now = new Date()) {
  const rows = await db.siteTopup.findMany({
    where: {
      customerId,
      createdAt: { gte: since },
      OR: [{ status: { in: ["CREDITED", "CHARGEBACK_WON"] } }, { status: "PENDING", createdAt: { gte: new Date(now.getTime() - PENDING_TOPUP_MS) } }],
    },
    select: { cents: true },
  });
  return rows.reduce((s, r) => s + r.cents, 0);
}

/** Cardbits spent on packs and singles in the window (PACK and SINGLE debits net of their refunds). */
export async function spendSince(db: Db, customerId: string, since: Date) {
  const agg = await db.siteLedger.aggregate({ where: { customerId, kind: { in: ["PACK", "SINGLE"] }, createdAt: { gte: since } }, _sum: { delta: true } });
  return Math.max(-(agg._sum.delta ?? 0), 0);
}

async function usedFor(db: Db, customerId: string, key: LimitKey, now: Date) {
  const [kind, period] = key.split(":") as [LimitKind, Period];
  const since = new Date(now.getTime() - PERIOD_MS[period]);
  return kind === "topup" ? topupCentsSince(db, customerId, since, now) : spendSince(db, customerId, since);
}

/** Throws LimitReached if adding `amount` (cents for topup, Cardbits for spend) breaks any limit of that kind. */
export async function assertWithinLimits(db: Db, customerId: string, kind: LimitKind, amount: number, now = new Date()) {
  const c = await playControl(db, customerId, now);
  for (const p of PERIODS) {
    const key = `${kind}:${p}` as LimitKey;
    const limit = c.limits[key];
    if (limit === undefined) continue;
    const used = await usedFor(db, customerId, key, now);
    if (used + amount > limit) throw new LimitReached(key, limit, used);
  }
}

/** Everything the Limits page shows. */
export async function playSummary(db: Db, customerId: string, now = new Date()) {
  const c = await playControl(db, customerId, now);
  const used: Partial<Record<LimitKey, number>> = {};
  for (const k of KINDS) for (const p of PERIODS) used[`${k}:${p}`] = await usedFor(db, customerId, `${k}:${p}`, now);
  return { ...c, pause: activePause(c, now), used };
}

/** Small block for the store state so the storefront can show a paused banner. */
export async function playStateFor(db: Db, customerId: string, now = new Date()) {
  const row = await db.sitePlayControl.findUnique({ where: { customerId }, select: { coolOffUntil: true, excludedUntil: true } });
  const p = row && activePause(row, now);
  return { paused: p ? { kind: p.kind, until: p.until.toISOString() } : null };
}
