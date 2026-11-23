import { Prisma, type Campaign } from "@prisma/client";
import { entriesByMethod } from "./entries/methods.server";
import db from "../db.server";
import { normalizeEmail } from "./bot/email";

// Campaign analytics for the admin. Everything is computed on read from the
// entrant table, the entry ledger and the order log; nothing is cached.

export interface DayPoint {
  day: string; // YYYY-MM-DD in the campaign timezone
  entrants: number;
  entries: number;
}

const DAY_MS = 86_400_000;

/** YYYY-MM-DD for `date` as seen in `timeZone`. */
export function dayKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Fills the gaps between the first and last day so the chart has no holes. */
export function fillDays(
  rows: { day: string; entrants?: number; entries?: number }[],
  maxDays = 120,
): DayPoint[] {
  const byDay = new Map<string, DayPoint>();
  for (const r of rows) {
    const p = byDay.get(r.day) ?? { day: r.day, entrants: 0, entries: 0 };
    p.entrants += r.entrants ?? 0;
    p.entries += r.entries ?? 0;
    byDay.set(r.day, p);
  }
  const days = [...byDay.keys()].sort();
  if (days.length === 0) return [];
  const out: DayPoint[] = [];
  const end = Date.parse(`${days.at(-1)}T00:00:00Z`);
  for (let t = Date.parse(`${days[0]}T00:00:00Z`); t <= end; t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, entrants: 0, entries: 0 });
  }
  return out.slice(-maxDays);
}

/** The order subtotal saved in OrderLog.breakdown by processOrder, if present. */
export function breakdownSubtotal(breakdown: unknown): number | null {
  if (!breakdown || typeof breakdown !== "object") return null;
  const v = (breakdown as { subtotal?: unknown }).subtotal;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function summarizeRevenue(logs: { breakdown: unknown }[]) {
  let revenue = 0;
  let missing = 0;
  for (const l of logs) {
    const s = breakdownSubtotal(l.breakdown);
    if (s === null) missing++;
    else revenue += s;
  }
  return {
    orders: logs.length,
    revenue: Math.round(revenue * 100) / 100,
    missing,
  };
}

/** Counts entrants by utm_source (falling back to "source"); no UTM is "(direct)". */
export function utmBreakdown(utms: unknown[]) {
  const counts = new Map<string, number>();
  for (const u of utms) {
    const obj =
      u && typeof u === "object" ? (u as Record<string, unknown>) : {};
    const raw = obj.utm_source ?? obj.source;
    const key =
      typeof raw === "string" && raw.trim()
        ? raw.trim().toLowerCase()
        : "(direct)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}

/**
 * Entrants who also placed an order. "Form" entrants are the ones who signed
 * up through the widget (they have a network hash); order auto-signups and
 * imports don't, and would make conversion look like 100%.
 */
export function conversion(
  entrants: { emailNormalized: string; fromForm: boolean }[],
  buyerEmails: Iterable<string>,
) {
  const buyers = new Set(buyerEmails);
  const form = entrants.filter((e) => e.fromForm);
  const formBuyers = form.filter((e) => buyers.has(e.emailNormalized)).length;
  return {
    buyers: entrants.filter((e) => buyers.has(e.emailNormalized)).length,
    formEntrants: form.length,
    formBuyers,
    rate: form.length ? formBuyers / form.length : 0,
  };
}

const rate = (n: number, d: number) => (d ? n / d : 0);

/** A half-open time window [start, end); either side open when null. */
export interface Window {
  start: Date | null;
  end: Date | null;
}

const ALL: Window = { start: null, end: null };

/** A Prisma `createdAt` filter for the window. */
const createdIn = (w: Window) =>
  w.start || w.end
    ? {
        createdAt: {
          ...(w.start ? { gte: w.start } : {}),
          ...(w.end ? { lt: w.end } : {}),
        },
      }
    : {};

/** The same filter as raw SQL, starting with AND. */
const createdInSql = (w: Window) =>
  Prisma.sql`${w.start ? Prisma.sql`AND "createdAt" >= ${w.start}` : Prisma.empty} ${
    w.end ? Prisma.sql`AND "createdAt" < ${w.end}` : Prisma.empty
  }`;

/**
 * Analytics for a giveaway, limited to `win`: sign-ups, entrant statuses, referrals, UTMs
 * and orders count by when they were created; entries by when they were earned.
 */
export async function campaignAnalytics(campaign: Campaign, win: Window = ALL) {
  const campaignId = campaign.id;
  const tz = campaign.timezone;
  const inWin = createdIn(win);
  const inWinSql = createdInSql(win);

  const [
    entrantDays,
    entryDays,
    statusCounts,
    verified,
    entrants,
    topReferrers,
    orderLogs,
    activity,
  ] = await Promise.all([
    db.$queryRaw<{ day: string; n: bigint }[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
             count(*) AS n
      FROM "Entrant" WHERE "campaignId" = ${campaignId} ${inWinSql}
      GROUP BY 1`,
    // Gross entries awarded per day; rollbacks are reported by source below.
    db.$queryRaw<{ day: string; n: bigint }[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
             coalesce(sum(entries), 0) AS n
      FROM "EntryEvent" WHERE "campaignId" = ${campaignId} AND entries > 0 ${inWinSql}
      GROUP BY 1`,
    db.entrant.groupBy({
      by: ["status"],
      where: { campaignId, ...inWin },
      _count: true,
    }),
    db.entrant.count({
      where: { campaignId, verifiedAt: { not: null }, ...inWin },
    }),
    db.entrant.findMany({
      where: { campaignId, ...inWin },
      select: { emailNormalized: true, utm: true, ipHash: true },
    }),
    db.entrant.groupBy({
      by: ["referredById"],
      where: { campaignId, referredById: { not: null }, ...inWin },
      _count: true,
      orderBy: { _count: { referredById: "desc" } },
      take: 10,
    }),
    db.orderLog.findMany({
      where: { campaignId, ...inWin },
      select: { status: true, email: true, breakdown: true },
    }),
    // Everyone who earned entries in the window, new or returning, and the net entries.
    db.$queryRaw<{ people: bigint; entries: bigint | null }[]>`
      SELECT count(DISTINCT "entrantId") FILTER (WHERE entries > 0) AS people,
             sum(entries) AS entries
      FROM "EntryEvent" WHERE "campaignId" = ${campaignId} ${inWinSql}`,
  ]);

  const referrerIds = topReferrers.map((r) => r.referredById!);
  const referrerRows = referrerIds.length
    ? await db.entrant.findMany({
        where: { id: { in: referrerIds } },
        select: { id: true, email: true, name: true },
      })
    : [];
  const referrerById = new Map(referrerRows.map((r) => [r.id, r]));

  const counts = Object.fromEntries(
    statusCounts.map((c) => [c.status, c._count]),
  ) as Record<string, number>;
  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  const entryLogs = orderLogs.filter((o) => o.status === "ENTRIES");
  const buyerEmails = orderLogs
    .filter((o) => o.email && o.status !== "ROLLED_BACK_CANCELLED")
    .map((o) => normalizeEmail(o.email!));

  return {
    days: fillDays([
      ...entrantDays.map((r) => ({ day: r.day, entrants: Number(r.n) })),
      ...entryDays.map((r) => ({ day: r.day, entries: Number(r.n) })),
    ]),
    methods: (
      await entriesByMethod(campaignId, {
        since: win.start ?? undefined,
        until: win.end ?? undefined,
      })
    ).rows,
    activity: {
      people: Number(activity[0]?.people ?? 0),
      entries: Math.max(0, Number(activity[0]?.entries ?? 0)),
    },
    topReferrers: topReferrers.map((r) => ({
      id: r.referredById!,
      email: referrerById.get(r.referredById!)?.email ?? "(deleted)",
      name: referrerById.get(r.referredById!)?.name ?? null,
      referrals: r._count,
    })),
    totals: {
      entrants: total,
      verified,
      held: counts.HELD ?? 0,
      unverified: counts.PENDING_VERIFICATION ?? 0,
      disqualified: counts.DISQUALIFIED ?? 0,
      verificationRate: rate(verified, total),
      holdRate: rate(counts.HELD ?? 0, total),
      disqualifiedRate: rate(counts.DISQUALIFIED ?? 0, total),
    },
    revenue: summarizeRevenue(entryLogs),
    utm: utmBreakdown(entrants.map((e) => e.utm)),
    conversion: conversion(
      entrants.map((e) => ({
        emailNormalized: e.emailNormalized,
        fromForm: e.ipHash !== null,
      })),
      buyerEmails,
    ),
  };
}

export type CampaignAnalytics = Awaited<ReturnType<typeof campaignAnalytics>>;
