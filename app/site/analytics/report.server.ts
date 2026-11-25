// Analytics reports for Card Broker's Cardbit Analytics tab (/internal/site-analytics), read-only.
// Money is kept apart the way the ledger keeps it: dollars charged (top-ups, $ shipping, Club),
// paid Cardbits vs bonus Cardbits from top-ups, Cardbits spent, buybacks issued and rewards issued.
// Staff accounts (SITE_STAFF_EMAILS), any browser a staff account used, and demo openings are left out.
import { Prisma, type PrismaClient } from "@prisma/client";
import { staffEmails } from "../shipping/staff.server";

export const TZ = "America/Chicago";
const LIVE_MS = 5 * 60_000;
const PAID_TOPUP = ["CREDITED", "REFUNDED", "CHARGEBACK", "CHARGEBACK_WON", "CHARGEBACK_LOST"];
const REFUNDED_TOPUP = ["REFUNDED", "CHARGEBACK", "CHARGEBACK_LOST"];
const SHIP_DONE = ["DRAFT", "CANCELED"];

// ---------- Dates ----------

/** Offset (ms) of a time zone from UTC at an instant. */
function tzOffset(at: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant a local calendar day starts in `tz`. */
export function zonedMidnight(day: string, tz = TZ): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  const first = new Date(guess.getTime() - tzOffset(guess, tz));
  return new Date(guess.getTime() - tzOffset(first, tz));
}

export const localDay = (at: Date, tz = TZ) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

export type Range = { from: string; to: string; start: Date; end: Date; days: number; hourly: boolean };

/** Inclusive local days → [start, end) instants. Defaults to the last 30 days; at most 400 days. */
export function parseRange(fromRaw: unknown, toRaw: unknown, now = new Date(), tz = TZ): Range {
  const ok = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  const today = localDay(now, tz);
  let to = ok(toRaw) ? (toRaw as string) : today;
  if (to > today) to = today;
  let from = ok(fromRaw) ? (fromRaw as string) : addDays(to, -29);
  if (from > to) from = to;
  if (daysBetween(from, to) > 399) from = addDays(to, -399);
  const days = daysBetween(from, to) + 1;
  return { from, to, start: zonedMidnight(from, tz), end: zonedMidnight(addDays(to, 1), tz), days, hourly: days === 1 };
}

export function previousRange(r: Range, tz = TZ): Range {
  const to = addDays(r.from, -1);
  const from = addDays(to, -(r.days - 1));
  return { from, to, start: zonedMidnight(from, tz), end: r.start, days: r.days, hourly: r.hourly };
}

/** Bucket keys for a chart: hours of one day, or every day of the range. */
function buckets(r: Range): string[] {
  if (r.hourly) return Array.from({ length: 24 }, (_, h) => `${r.from} ${String(h).padStart(2, "0")}`);
  return Array.from({ length: r.days }, (_, i) => addDays(r.from, i));
}

// ---------- Shared SQL ----------

const num = (v: unknown) => (v == null ? 0 : Number(v));

async function staffIds(db: PrismaClient, env: NodeJS.ProcessEnv) {
  const emails = [...staffEmails(env)];
  if (!emails.length) return [] as string[];
  return (await db.siteCustomer.findMany({ where: { email: { in: emails } }, select: { id: true } })).map((c) => c.id);
}

const notStaff = (col: Prisma.Sql, ids: string[]) => Prisma.sql`(${col} IS NULL OR NOT (${col} = ANY(${ids}::text[])))`;
const bucketSql = (col: Prisma.Sql, r: Range, tz: string) =>
  r.hourly
    ? Prisma.sql`to_char((${col} AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24')`
    : Prisma.sql`to_char((${col} AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD')`;

/**
 * Visits in a window with a `converted` flag: the signed-in customer bought something (a paid
 * top-up, a non-demo pack, a single) between the visit's start and 30 minutes after its last page.
 */
function visitsSql(start: Date, end: Date, ids: string[]) {
  return Prisma.sql`
    SELECT v.*,
      (v."customerId" IS NOT NULL AND (
        EXISTS (SELECT 1 FROM "SiteTopup" t WHERE t."customerId" = v."customerId" AND t.status = ANY(${PAID_TOPUP}::text[])
                AND t."createdAt" BETWEEN v."startedAt" AND v."lastSeenAt" + interval '30 minutes')
        OR EXISTS (SELECT 1 FROM "SiteOpening" o WHERE o."customerId" = v."customerId" AND NOT o.demo
                AND o."createdAt" BETWEEN v."startedAt" AND v."lastSeenAt" + interval '30 minutes')
        OR EXISTS (SELECT 1 FROM "SiteLedger" l WHERE l."customerId" = v."customerId" AND l.kind = 'SINGLE'
                AND l."createdAt" BETWEEN v."startedAt" AND v."lastSeenAt" + interval '30 minutes')
      )) AS converted
    FROM "SiteVisit" v
    WHERE v."startedAt" >= ${start} AND v."startedAt" < ${end}
      AND NOT v.staff
      AND ${notStaff(Prisma.sql`v."customerId"`, ids)}
      AND NOT EXISTS (SELECT 1 FROM "SiteVisit" s WHERE s."visitorId" = v."visitorId" AND s.staff)`;
}

// ---------- Overview ----------

type Totals = Awaited<ReturnType<typeof totalsFor>>;

async function totalsFor(db: PrismaClient, start: Date, end: Date, ids: string[]) {
  const ns = (col: string) => notStaff(Prisma.raw(col), ids);
  const [topups, ship, club, opens, ledger, buyers, signups, visits] = await Promise.all([
    db.$queryRaw<{ n: bigint; cents: bigint; base: bigint; bonus: bigint; refunds: bigint; refunded_n: bigint; abandoned: bigint }[]>`
      SELECT count(*) FILTER (WHERE status = ANY(${PAID_TOPUP}::text[])) n,
             coalesce(sum(cents) FILTER (WHERE status = ANY(${PAID_TOPUP}::text[])), 0) cents,
             coalesce(sum("baseBits") FILTER (WHERE status = ANY(${PAID_TOPUP}::text[])), 0) base,
             coalesce(sum("bonusBits") FILTER (WHERE status = ANY(${PAID_TOPUP}::text[])), 0) bonus,
             coalesce(sum(cents) FILTER (WHERE status = ANY(${REFUNDED_TOPUP}::text[])), 0) refunds,
             count(*) FILTER (WHERE status = ANY(${REFUNDED_TOPUP}::text[])) refunded_n,
             count(*) FILTER (WHERE status = 'PENDING' AND "createdAt" < now() - interval '1 hour') abandoned
      FROM "SiteTopup" WHERE "createdAt" >= ${start} AND "createdAt" < ${end} AND ${ns('"customerId"')}`,
    db.$queryRaw<{ n: bigint; usd: bigint; bits: bigint; free: bigint; cards: bigint }[]>`
      SELECT count(*) n,
             coalesce(sum("feeCents") FILTER (WHERE "feeKind" = 'USD'), 0) usd,
             coalesce(sum("feeBits") FILTER (WHERE "feeKind" = 'CARDBITS'), 0) bits,
             count(*) FILTER (WHERE "feeKind" = 'FREE') free,
             coalesce(sum("cardCount"), 0) cards
      FROM "SiteShipment" WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
        AND NOT (status = ANY(${SHIP_DONE}::text[])) AND ${ns('"customerId"')}`,
    db.$queryRaw<{ n: bigint; cents: bigint; refunds: bigint }[]>`
      SELECT count(*) n, coalesce(sum(cents), 0) cents,
             coalesce(sum(cents) FILTER (WHERE status IN ('REFUNDED', 'CHARGEBACK')), 0) refunds
      FROM "SiteSubscriptionPayment" WHERE "createdAt" >= ${start} AND "createdAt" < ${end} AND ${ns('"customerId"')}`,
    db.$queryRaw<{ n: bigint; bits: bigint }[]>`
      SELECT count(*) n, coalesce(sum("priceBits"), 0) bits
      FROM "SiteOpening" WHERE "createdAt" >= ${start} AND "createdAt" < ${end} AND NOT demo AND ${ns('"customerId"')}`,
    db.$queryRaw<{ kind: string; n: bigint; bits: bigint }[]>`
      SELECT kind, count(*) n, coalesce(sum(delta), 0) bits
      FROM "SiteLedger" WHERE "createdAt" >= ${start} AND "createdAt" < ${end} AND ${ns('"customerId"')}
      GROUP BY kind`,
    db.$queryRaw<{ buyers: bigint; repeat_buyers: bigint }[]>`
      WITH p AS (
        SELECT "customerId", "createdAt" FROM "SiteTopup" WHERE status = ANY(${PAID_TOPUP}::text[])
        UNION ALL SELECT "customerId", "createdAt" FROM "SiteOpening" WHERE NOT demo
        UNION ALL SELECT "customerId", "createdAt" FROM "SiteLedger" WHERE kind = 'SINGLE'
      ), b AS (SELECT DISTINCT "customerId" FROM p WHERE "createdAt" >= ${start} AND "createdAt" < ${end} AND ${ns('"customerId"')})
      SELECT count(*) buyers,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM p WHERE p."customerId" = b."customerId" AND p."createdAt" < ${start})) repeat_buyers
      FROM b`,
    db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) n FROM "SiteCustomer" WHERE "createdAt" >= ${start} AND "createdAt" < ${end} AND ${ns("id")}`,
    db.$queryRaw<{ sessions: bigint; visitors: bigint; converted: bigint }[]>`
      WITH v AS (${visitsSql(start, end, ids)})
      SELECT count(*) sessions, count(DISTINCT "visitorId") visitors, count(*) FILTER (WHERE converted) converted FROM v`,
  ]);
  const t = topups[0];
  const k = Object.fromEntries(ledger.map((l) => [l.kind, { n: num(l.n), bits: num(l.bits) }]));
  const kind = (name: string) => k[name] ?? { n: 0, bits: 0 };
  const grossCents = num(t.cents) + num(ship[0].usd) + num(club[0].cents);
  const refundCents = num(t.refunds) + num(club[0].refunds);
  const packs = { n: num(opens[0].n), bits: num(opens[0].bits) };
  const singles = { n: kind("SINGLE").n, bits: -kind("SINGLE").bits };
  const shipments = num(ship[0].n);
  const orders = packs.n + singles.n + shipments;
  const sessions = num(visits[0].sessions);
  return {
    grossCents,
    refundCents,
    netCents: grossCents - refundCents,
    topups: { n: num(t.n), cents: num(t.cents), paidBits: num(t.base), bonusBits: num(t.bonus), avgCents: num(t.n) ? Math.round(num(t.cents) / num(t.n)) : 0, refunded: num(t.refunded_n), abandoned: num(t.abandoned) },
    shipping: { n: shipments, usdCents: num(ship[0].usd), bits: num(ship[0].bits), free: num(ship[0].free), cards: num(ship[0].cards) },
    club: { n: num(club[0].n), cents: num(club[0].cents) },
    orders,
    packs,
    singles,
    spentBits: packs.bits + singles.bits + -kind("SHIPPING").bits,
    buybacks: { n: kind("BUYBACK").n, bits: kind("BUYBACK").bits },
    rewardsBits: kind("REWARD").bits,
    bonusBits: kind("BONUS").bits,
    adjustBits: kind("ADJUST").bits,
    clawbackBits: kind("REFUND").bits + kind("CHARGEBACK").bits,
    customers: { signups: num(signups[0].n), buyers: num(buyers[0].buyers), returning: num(buyers[0].repeat_buyers) },
    returningRate: num(buyers[0].buyers) ? num(buyers[0].repeat_buyers) / num(buyers[0].buyers) : 0,
    sessions,
    visitors: num(visits[0].visitors),
    converted: num(visits[0].converted),
    conversionRate: sessions ? num(visits[0].converted) / sessions : 0,
  };
}

async function seriesFor(db: PrismaClient, r: Range, ids: string[], tz: string) {
  const b = (col: string) => bucketSql(Prisma.raw(col), r, tz);
  const ns = (col: string) => notStaff(Prisma.raw(col), ids);
  const [sales, orders, visits] = await Promise.all([
    db.$queryRaw<{ k: string; cents: bigint }[]>`
      SELECT k, sum(cents) cents FROM (
        SELECT ${b('"createdAt"')} k, cents FROM "SiteTopup"
          WHERE status = ANY(${PAID_TOPUP}::text[]) AND "createdAt" >= ${r.start} AND "createdAt" < ${r.end} AND ${ns('"customerId"')}
        UNION ALL SELECT ${b('"createdAt"')} k, "feeCents" FROM "SiteShipment"
          WHERE "feeKind" = 'USD' AND NOT (status = ANY(${SHIP_DONE}::text[])) AND "createdAt" >= ${r.start} AND "createdAt" < ${r.end} AND ${ns('"customerId"')}
        UNION ALL SELECT ${b('"createdAt"')} k, cents FROM "SiteSubscriptionPayment"
          WHERE "createdAt" >= ${r.start} AND "createdAt" < ${r.end} AND ${ns('"customerId"')}
      ) x GROUP BY k`,
    db.$queryRaw<{ k: string; n: bigint; bits: bigint }[]>`
      SELECT k, count(*) n, sum(bits) bits FROM (
        SELECT ${b('"createdAt"')} k, "priceBits" bits FROM "SiteOpening"
          WHERE NOT demo AND "createdAt" >= ${r.start} AND "createdAt" < ${r.end} AND ${ns('"customerId"')}
        UNION ALL SELECT ${b('"createdAt"')} k, -delta FROM "SiteLedger"
          WHERE kind = 'SINGLE' AND "createdAt" >= ${r.start} AND "createdAt" < ${r.end} AND ${ns('"customerId"')}
        UNION ALL SELECT ${b('"createdAt"')} k, 0 FROM "SiteShipment"
          WHERE NOT (status = ANY(${SHIP_DONE}::text[])) AND "createdAt" >= ${r.start} AND "createdAt" < ${r.end} AND ${ns('"customerId"')}
      ) x GROUP BY k`,
    db.$queryRaw<{ k: string; sessions: bigint; visitors: bigint; converted: bigint }[]>`
      WITH v AS (${visitsSql(r.start, r.end, ids)})
      SELECT ${b('"startedAt"')} k, count(*) sessions, count(DISTINCT "visitorId") visitors, count(*) FILTER (WHERE converted) converted
      FROM v GROUP BY 1`,
  ]);
  const by = <T extends { k: string }>(rows: T[]) => new Map(rows.map((x) => [x.k, x]));
  const s = by(sales), o = by(orders), v = by(visits);
  return buckets(r).map((k) => ({
    k,
    cents: num(s.get(k)?.cents),
    orders: num(o.get(k)?.n),
    spentBits: num(o.get(k)?.bits),
    sessions: num(v.get(k)?.sessions),
    visitors: num(v.get(k)?.visitors),
    converted: num(v.get(k)?.converted),
  }));
}

export type AnalyticsDeps = { now?: Date; env?: NodeJS.ProcessEnv; tz?: string };

export async function overview(db: PrismaClient, input: { from?: unknown; to?: unknown }, deps: AnalyticsDeps = {}) {
  const tz = deps.tz ?? TZ;
  const r = parseRange(input.from, input.to, deps.now, tz);
  const p = previousRange(r, tz);
  const ids = await staffIds(db, deps.env ?? process.env);
  const [current, previous, series, previousSeries, topPacks] = await Promise.all([
    totalsFor(db, r.start, r.end, ids),
    totalsFor(db, p.start, p.end, ids),
    seriesFor(db, r, ids, tz),
    seriesFor(db, p, ids, tz),
    db.$queryRaw<{ id: string; title: string | null; n: bigint; bits: bigint }[]>`
      SELECT o."packId" id, max(p.title) title, count(*) n, coalesce(sum(o."priceBits"), 0) bits
      FROM "SiteOpening" o LEFT JOIN "SitePack" p ON p.id = o."packId"
      WHERE NOT o.demo AND o."createdAt" >= ${r.start} AND o."createdAt" < ${r.end} AND ${notStaff(Prisma.sql`o."customerId"`, ids)}
      GROUP BY o."packId" ORDER BY n DESC LIMIT 10`,
  ]);
  return {
    range: { from: r.from, to: r.to, days: r.days, hourly: r.hourly, tz },
    previousRange: { from: p.from, to: p.to },
    current,
    previous,
    series,
    previousSeries,
    topPacks: topPacks.map((x) => ({ id: x.id, title: x.title ?? x.id, n: num(x.n), bits: num(x.bits) })),
  };
}

export type OverviewReport = Awaited<ReturnType<typeof overview>>;
export type { Totals };

// ---------- Live view ----------

export async function live(db: PrismaClient, deps: AnalyticsDeps = {}) {
  const tz = deps.tz ?? TZ;
  const now = deps.now ?? new Date();
  const ids = await staffIds(db, deps.env ?? process.env);
  const since = new Date(now.getTime() - LIVE_MS);
  const today = parseRange(localDay(now, tz), localDay(now, tz), now, tz);
  const hour = new Date(now.getTime() - 3600_000);
  const half = new Date(now.getTime() - 30 * 60_000);
  const liveV = Prisma.sql`
    SELECT v.* FROM "SiteVisit" v
    WHERE v."lastSeenAt" >= ${since} AND NOT v.staff AND ${notStaff(Prisma.sql`v."customerId"`, ids)}
      AND NOT EXISTS (SELECT 1 FROM "SiteVisit" s WHERE s."visitorId" = v."visitorId" AND s.staff)`;
  const group = (col: string, limit = 8) =>
    db.$queryRaw<{ key: string | null; n: bigint }[]>`
      WITH v AS (${liveV}) SELECT ${Prisma.raw(col)} key, count(*) n FROM v GROUP BY 1 ORDER BY n DESC LIMIT ${limit}`;
  const ns = (col: string) => notStaff(Prisma.raw(col), ids);
  const [count, pages, sources, devices, places, minutes, todayTotals, checkout, feedTopups, feedOpens, feedLedger, feedShip, feedSignups] = await Promise.all([
    db.$queryRaw<{ n: bigint; signed: bigint }[]>`WITH v AS (${liveV}) SELECT count(*) n, count(*) FILTER (WHERE "customerId" IS NOT NULL) signed FROM v`,
    group(`"exitPath"`, 10),
    group(`source`),
    group(`device`),
    group(`coalesce(region || ', ' || country, country)`),
    db.$queryRaw<{ m: string; n: bigint }[]>`
      SELECT to_char(date_trunc('minute', pv."createdAt"), 'YYYY-MM-DD"T"HH24:MI') m, count(DISTINCT pv."visitId") n
      FROM "SitePageView" pv JOIN "SiteVisit" v ON v.id = pv."visitId"
      WHERE pv."createdAt" >= ${half} AND NOT v.staff AND ${notStaff(Prisma.sql`v."customerId"`, ids)}
      GROUP BY 1`,
    totalsFor(db, today.start, today.end, ids),
    db.$queryRaw<{ pending: bigint; paid: bigint }[]>`
      SELECT count(*) FILTER (WHERE status = 'PENDING') pending, count(*) FILTER (WHERE status = ANY(${PAID_TOPUP}::text[])) paid
      FROM "SiteTopup" WHERE "createdAt" >= ${half} AND ${ns('"customerId"')}`,
    db.siteTopup.findMany({ where: { createdAt: { gte: hour }, customerId: { notIn: ids } }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.siteOpening.findMany({ where: { createdAt: { gte: hour }, demo: false, customerId: { notIn: ids } }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.siteLedger.findMany({ where: { createdAt: { gte: hour }, kind: { in: ["SINGLE", "BUYBACK"] }, customerId: { notIn: ids } }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.siteShipment.findMany({ where: { createdAt: { gte: hour }, status: { notIn: SHIP_DONE }, customerId: { notIn: ids } }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.siteCustomer.findMany({ where: { createdAt: { gte: hour }, id: { notIn: ids } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, createdAt: true } }),
  ]);
  const packs = new Map((await db.sitePack.findMany({ select: { id: true, title: true } })).map((p) => [p.id, p.title]));
  type Event = { at: string; kind: string; label: string; customerId: string; cents?: number; bits?: number };
  const feed: Event[] = [
    ...feedTopups.map((t) => ({
      at: t.createdAt.toISOString(),
      kind: t.status === "PENDING" ? "checkout" : "topup",
      label: t.status === "PENDING" ? "Started a Cardbits checkout" : "Bought Cardbits",
      customerId: t.customerId,
      cents: t.cents,
      bits: t.baseBits + t.bonusBits,
    })),
    ...feedOpens.map((o) => ({ at: o.createdAt.toISOString(), kind: "pack", label: `Opened ${packs.get(o.packId) ?? o.packId}`, customerId: o.customerId, bits: o.priceBits })),
    ...feedLedger.map((l) => ({
      at: l.createdAt.toISOString(),
      kind: l.kind === "SINGLE" ? "single" : "buyback",
      label: l.kind === "SINGLE" ? "Bought a single" : "Sold a card back",
      customerId: l.customerId,
      bits: Math.abs(l.delta),
    })),
    ...feedShip.map((s) => ({ at: s.createdAt.toISOString(), kind: "ship", label: `Asked to ship ${s.cardCount} card${s.cardCount === 1 ? "" : "s"}`, customerId: s.customerId, cents: s.feeCents || undefined, bits: s.feeBits || undefined })),
    ...feedSignups.map((c) => ({ at: c.createdAt.toISOString(), kind: "signup", label: "Created an account", customerId: c.id })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 40);
  const emails = new Map(
    (await db.siteCustomer.findMany({ where: { id: { in: [...new Set(feed.map((f) => f.customerId))] } }, select: { id: true, email: true } })).map((c) => [c.id, c.email]),
  );
  const minuteMap = new Map(minutes.map((m) => [m.m, num(m.n)]));
  const perMinute = Array.from({ length: 30 }, (_, i) => {
    const t = new Date(Math.floor(now.getTime() / 60_000) * 60_000 - (29 - i) * 60_000);
    return { m: t.toISOString().slice(0, 16), n: minuteMap.get(t.toISOString().slice(0, 16)) ?? 0 };
  });
  const rows = (x: { key: string | null; n: bigint }[]) => x.map((r) => ({ key: r.key ?? "Unknown", n: num(r.n) }));
  return {
    at: now.toISOString(),
    windowMinutes: LIVE_MS / 60_000,
    visitors: num(count[0].n),
    signedIn: num(count[0].signed),
    pages: rows(pages),
    sources: rows(sources),
    devices: rows(devices),
    places: rows(places),
    perMinute,
    checkout: { pending: num(checkout[0].pending), paid: num(checkout[0].paid) },
    today: { from: today.from, grossCents: todayTotals.grossCents, orders: todayTotals.orders, sessions: todayTotals.sessions, visitors: todayTotals.visitors, conversionRate: todayTotals.conversionRate, signups: todayTotals.customers.signups },
    feed: feed.map((f) => ({ ...f, email: emails.get(f.customerId) ?? null })),
  };
}

// ---------- Traffic ----------

export async function traffic(db: PrismaClient, input: { from?: unknown; to?: unknown }, deps: AnalyticsDeps = {}) {
  const tz = deps.tz ?? TZ;
  const r = parseRange(input.from, input.to, deps.now, tz);
  const p = previousRange(r, tz);
  const ids = await staffIds(db, deps.env ?? process.env);
  const V = visitsSql(r.start, r.end, ids);
  const totals = (start: Date, end: Date) =>
    db.$queryRaw<{ sessions: bigint; visitors: bigint; pageviews: bigint; bounces: bigint; seconds: number | null; fresh: bigint; converted: bigint }[]>`
      WITH v AS (${visitsSql(start, end, ids)})
      SELECT count(*) sessions, count(DISTINCT "visitorId") visitors, coalesce(sum(pageviews), 0) pageviews,
             count(*) FILTER (WHERE pageviews <= 1) bounces,
             avg(extract(epoch FROM ("lastSeenAt" - "startedAt")))::float8 seconds,
             count(*) FILTER (WHERE "newVisitor") fresh,
             count(*) FILTER (WHERE converted) converted
      FROM v`;
  const breakdown = (col: string, limit = 15, where = "TRUE") =>
    db.$queryRaw<{ key: string | null; sessions: bigint; visitors: bigint; converted: bigint; pageviews: bigint }[]>`
      WITH v AS (${V})
      SELECT ${Prisma.raw(col)} key, count(*) sessions, count(DISTINCT "visitorId") visitors,
             count(*) FILTER (WHERE converted) converted, coalesce(sum(pageviews), 0) pageviews
      FROM v WHERE ${Prisma.raw(where)} GROUP BY 1 ORDER BY sessions DESC LIMIT ${limit}`;
  const [cur, prev, series, sources, referrers, campaigns, devices, browsers, oses, countries, regions, landing, pages] = await Promise.all([
    totals(r.start, r.end),
    totals(p.start, p.end),
    seriesFor(db, r, ids, tz),
    breakdown("source", 12),
    breakdown(`coalesce("sourceName", "referrerHost")`, 15, `source <> 'direct'`),
    breakdown(`concat_ws(' / ', coalesce("utmSource", '—'), coalesce("utmMedium", '—'), coalesce("utmCampaign", '—'))`, 15, `"utmSource" IS NOT NULL OR "utmMedium" IS NOT NULL OR "utmCampaign" IS NOT NULL`),
    breakdown("device", 5),
    breakdown("browser", 8),
    breakdown("os", 8),
    breakdown("country", 12),
    breakdown("region", 15, `country = 'US'`),
    breakdown(`"landingPath"`, 15),
    db.$queryRaw<{ key: string; views: bigint; visits: bigint }[]>`
      WITH v AS (${V})
      SELECT pv.path key, count(*) views, count(DISTINCT pv."visitId") visits
      FROM "SitePageView" pv JOIN v ON v.id = pv."visitId"
      GROUP BY pv.path ORDER BY views DESC LIMIT 20`,
  ]);
  const t = (x: (typeof cur)[number]) => {
    const sessions = num(x.sessions);
    return {
      sessions,
      visitors: num(x.visitors),
      pageviews: num(x.pageviews),
      bounceRate: sessions ? num(x.bounces) / sessions : 0,
      avgSeconds: Math.round(x.seconds ?? 0),
      newVisitorRate: sessions ? num(x.fresh) / sessions : 0,
      converted: num(x.converted),
      conversionRate: sessions ? num(x.converted) / sessions : 0,
      pagesPerSession: sessions ? num(x.pageviews) / sessions : 0,
    };
  };
  const rows = (x: Awaited<ReturnType<typeof breakdown>>) =>
    x.map((row) => ({ key: row.key ?? "Unknown", sessions: num(row.sessions), visitors: num(row.visitors), converted: num(row.converted), pageviews: num(row.pageviews) }));
  return {
    range: { from: r.from, to: r.to, days: r.days, hourly: r.hourly, tz },
    previousRange: { from: p.from, to: p.to },
    current: t(cur[0]),
    previous: t(prev[0]),
    series: series.map(({ k, sessions, visitors, converted }) => ({ k, sessions, visitors, converted })),
    sources: rows(sources),
    referrers: rows(referrers),
    campaigns: rows(campaigns),
    devices: rows(devices),
    browsers: rows(browsers),
    os: rows(oses),
    countries: rows(countries),
    regions: rows(regions),
    landing: rows(landing),
    pages: pages.map((x) => ({ key: x.key, views: num(x.views), visits: num(x.visits) })),
  };
}
