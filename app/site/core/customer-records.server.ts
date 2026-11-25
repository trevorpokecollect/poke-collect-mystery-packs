// Shopify-style customer records for Card Broker's Cardbit Customers tab (Trevor 2026-11-25:
// "data for all things shopify had like email and SMS marketing tags").
// List with filters (consent, tags, buyer, account status, Club) and one customer's full record:
// consent with date and source, tags, staff note, addresses, orders, amount spent, first visit.
// Staff can edit tags and the note, and unsubscribe a customer on request (never subscribe them:
// consent only comes from the customer). Every consent write clears syncedAt so Klaviyo picks it up.
import type { PrismaClient, SiteMarketing } from "@prisma/client";
import { listOrders } from "./orders-desk.server";
import { leave } from "../promos/promos.server";

const PAID = ["CREDITED", "CHARGEBACK_WON"];
const MAX_SCAN = 20_000;

export type EmailStatus = "subscribed" | "unsubscribed" | "never";
export type SmsStatus = "subscribed" | "pending" | "unsubscribed" | "never";

type Consent = Pick<SiteMarketing, "emailOptInAt" | "emailOptOutAt" | "smsRequestedAt" | "smsConfirmedAt" | "smsOptOutAt"> | null | undefined;

export function emailStatus(m: Consent): EmailStatus {
  if (m?.emailOptInAt && (!m.emailOptOutAt || m.emailOptOutAt < m.emailOptInAt)) return "subscribed";
  return m?.emailOptOutAt ? "unsubscribed" : "never";
}

export function smsStatus(m: Consent): SmsStatus {
  if (m?.smsConfirmedAt && (!m.smsOptOutAt || m.smsOptOutAt < m.smsConfirmedAt)) return "subscribed";
  if (m?.smsRequestedAt && (!m.smsOptOutAt || m.smsOptOutAt < m.smsRequestedAt)) return "pending";
  return m?.smsOptOutAt ? "unsubscribed" : "never";
}

export const normalizeTag = (t: unknown) =>
  String(t ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 40);

export function normalizeTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  return [...new Set(list.map(normalizeTag).filter(Boolean))].slice(0, 30);
}

export type RecordsQuery = {
  q?: string;
  email?: string; // subscribed | unsubscribed | never
  sms?: string; // subscribed | pending | unsubscribed | never
  tag?: string;
  buyer?: string; // yes | no
  status?: string; // active | frozen | closed | review
  club?: string; // yes
  sort?: string; // newest | oldest | spent | orders | last_order
  offset?: number;
  limit?: number;
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const later = (...ds: (Date | null | undefined)[]) => ds.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);

/** Per-customer order totals for the given ids (paid top-ups, real pack openings, singles bought). */
async function totals(db: PrismaClient, ids: string[]) {
  const where = { customerId: { in: ids } };
  const [topups, opens, singles, wallets, vault, marketing, clubs] = await Promise.all([
    db.siteTopup.groupBy({ by: ["customerId"], where: { ...where, status: { in: PAID } }, _count: { _all: true }, _sum: { cents: true }, _max: { createdAt: true } }),
    db.siteOpening.groupBy({ by: ["customerId"], where: { ...where, demo: false }, _count: { _all: true }, _sum: { priceBits: true }, _max: { createdAt: true } }),
    db.siteLedger.groupBy({ by: ["customerId"], where: { ...where, kind: "SINGLE" }, _count: { _all: true }, _max: { createdAt: true } }),
    db.siteWallet.findMany({ where }),
    db.siteCopy.groupBy({ by: ["ownerId"], where: { ownerId: { in: ids }, status: "VAULTED" }, _count: { _all: true } }),
    db.siteMarketing.findMany({ where }),
    db.siteSubscription.findMany({ where: { ...where, status: { in: ["ACTIVE", "PAST_DUE"] } }, select: { customerId: true, tier: true } }),
  ]);
  const by = <T extends { customerId: string }>(rows: T[]) => new Map(rows.map((r) => [r.customerId, r]));
  return {
    topups: by(topups),
    opens: by(opens),
    singles: by(singles),
    wallets: by(wallets),
    vault: new Map(vault.map((v) => [v.ownerId as string, v._count._all])),
    marketing: by(marketing),
    clubs: by(clubs),
  };
}

/** Customers with consent, tags and order totals, filtered and sorted like Shopify's customer list. */
export async function listCustomerRecords(db: PrismaClient, query: RecordsQuery) {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const q = (query.q || "").trim().toLowerCase().slice(0, 120);
  const tag = normalizeTag(query.tag);
  const status = query.status;
  const base = await db.siteCustomer.findMany({
    where: {
      ...(q ? { OR: [{ email: { contains: q } }, { name: { contains: q, mode: "insensitive" } }, { id: q }, { tags: { has: q } }] } : {}),
      ...(tag ? { tags: { has: tag } } : {}),
      ...(status === "active" ? { frozenAt: null, closedAt: null } : status === "frozen" ? { frozenAt: { not: null }, closedAt: null } : status === "closed" ? { closedAt: { not: null } } : status === "review" ? { riskStatus: "review" } : {}),
    },
    orderBy: [{ createdAt: query.sort === "oldest" ? "asc" : "desc" }, { id: "desc" }],
    take: MAX_SCAN,
    select: { id: true, email: true, name: true, signupMethod: true, tags: true, riskStatus: true, frozenAt: true, closedAt: true, createdAt: true },
  });
  const t = await totals(db, base.map((c) => c.id));
  let rows = base.map((c) => {
    const top = t.topups.get(c.id),
      op = t.opens.get(c.id),
      si = t.singles.get(c.id),
      m = t.marketing.get(c.id);
    const orders = (top?._count._all ?? 0) + (op?._count._all ?? 0) + (si?._count._all ?? 0);
    return {
      id: c.id,
      email: c.email,
      name: c.name,
      status: c.closedAt ? "Closed" : c.frozenAt ? "Frozen" : c.riskStatus === "review" ? "In Review" : "Active",
      createdAt: c.createdAt.toISOString(),
      signupMethod: c.signupMethod,
      tags: c.tags,
      emailStatus: emailStatus(m),
      smsStatus: smsStatus(m),
      orders,
      spentCents: top?._sum.cents ?? 0,
      lastOrderAt: iso(later(top?._max.createdAt, op?._max.createdAt, si?._max.createdAt)),
      balanceBits: t.wallets.get(c.id)?.balance ?? 0,
      packsOpened: op?._count._all ?? 0,
      vaultCards: t.vault.get(c.id) ?? 0,
      club: t.clubs.get(c.id)?.tier ?? null,
    };
  });
  if (query.email) rows = rows.filter((r) => r.emailStatus === query.email);
  if (query.sms) rows = rows.filter((r) => r.smsStatus === query.sms);
  if (query.buyer === "yes") rows = rows.filter((r) => r.orders > 0);
  if (query.buyer === "no") rows = rows.filter((r) => r.orders === 0);
  if (query.club === "yes") rows = rows.filter((r) => r.club);
  if (query.sort === "spent") rows.sort((a, b) => b.spentCents - a.spentCents || b.orders - a.orders);
  if (query.sort === "orders") rows.sort((a, b) => b.orders - a.orders || b.spentCents - a.spentCents);
  if (query.sort === "last_order") rows.sort((a, b) => (b.lastOrderAt ?? "").localeCompare(a.lastOrderAt ?? ""));
  const [total, tagRows] = await Promise.all([
    db.siteCustomer.count(),
    db.$queryRaw<{ tag: string; n: bigint }[]>`SELECT t AS tag, COUNT(*) AS n FROM "SiteCustomer", unnest("tags") AS t GROUP BY t ORDER BY t`,
  ]);
  const all = rows.length;
  return {
    total,
    matched: all,
    counts: {
      emailSubscribed: rows.filter((r) => r.emailStatus === "subscribed").length,
      smsSubscribed: rows.filter((r) => r.smsStatus === "subscribed").length,
      buyers: rows.filter((r) => r.orders > 0).length,
      spentCents: rows.reduce((s, r) => s + r.spentCents, 0),
    },
    tags: tagRows.map((r) => ({ tag: r.tag, count: Number(r.n) })),
    customers: rows.slice(offset, offset + limit),
    next: offset + limit < all ? offset + limit : null,
  };
}

/** One customer's full record. */
export async function customerRecord(db: PrismaClient, id: string) {
  const c = await db.siteCustomer.findUnique({ where: { id } });
  if (!c) return null;
  const [t, ledger, shipments, firstVisit, lastVisit, subs, orders, firstTop, firstOpen] = await Promise.all([
    totals(db, [id]),
    db.siteLedger.groupBy({ by: ["kind"], where: { customerId: id }, _sum: { delta: true }, _count: { _all: true } }),
    db.siteShipment.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, select: { toName: true, toAddress: true, createdAt: true, status: true } }),
    db.siteVisit.findFirst({ where: { customerId: id }, orderBy: { startedAt: "asc" } }),
    db.siteVisit.findFirst({ where: { customerId: id }, orderBy: { startedAt: "desc" } }),
    db.siteSubscription.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, take: 5 }),
    listOrders(db, { q: id, limit: 25 }),
    db.siteTopup.findFirst({ where: { customerId: id, status: { in: PAID } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.siteOpening.findFirst({ where: { customerId: id, demo: false }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  const m = t.marketing.get(id);
  const top = t.topups.get(id),
    op = t.opens.get(id),
    si = t.singles.get(id);
  const kind = (k: string) => ledger.find((l) => l.kind === k)?._sum.delta ?? 0;
  const orderCount = (top?._count._all ?? 0) + (op?._count._all ?? 0) + (si?._count._all ?? 0);
  // Distinct shipping addresses, newest first.
  const seen = new Set<string>();
  const addresses = [];
  for (const s of shipments) {
    const a = (s.toAddress && typeof s.toAddress === "object" ? s.toAddress : {}) as Record<string, unknown>;
    const pick = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : null);
    const addr = { name: s.toName, line1: pick("street1") ?? pick("line1"), line2: pick("street2") ?? pick("line2"), city: pick("city"), state: pick("state"), zip: pick("zip") ?? pick("postalCode"), lastUsedAt: s.createdAt.toISOString() };
    const key = [addr.name, addr.line1, addr.line2, addr.city, addr.state, addr.zip].join("|").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push(addr);
  }
  const club = subs.find((s) => s.status === "ACTIVE" || s.status === "PAST_DUE") ?? null;
  return {
    id: c.id,
    email: c.email,
    name: c.name,
    createdAt: c.createdAt.toISOString(),
    signupMethod: c.signupMethod,
    status: c.closedAt ? "Closed" : c.frozenAt ? "Frozen" : c.riskStatus === "review" ? "In Review" : "Active",
    frozenAt: iso(c.frozenAt),
    closedAt: iso(c.closedAt),
    riskStatus: c.riskStatus,
    riskNote: c.riskNote,
    termsVersion: c.termsVersion,
    termsAcceptedAt: iso(c.termsAcceptedAt),
    tags: c.tags,
    note: c.staffNote,
    consent: {
      email: { status: emailStatus(m), optInAt: iso(m?.emailOptInAt), optOutAt: iso(m?.emailOptOutAt), source: m?.emailSource ?? null },
      sms: {
        status: smsStatus(m),
        phone: m?.smsPhone ?? null,
        requestedAt: iso(m?.smsRequestedAt),
        confirmedAt: iso(m?.smsConfirmedAt),
        optOutAt: iso(m?.smsOptOutAt),
        source: m?.smsSource ?? null,
      },
      consentTerms: m?.termsVersion ?? null,
      syncedAt: iso(m?.syncedAt),
    },
    stats: {
      orders: orderCount,
      topups: top?._count._all ?? 0,
      packsOpened: op?._count._all ?? 0,
      singlesBought: si?._count._all ?? 0,
      spentCents: top?._sum.cents ?? 0,
      avgTopupCents: top?._count._all ? Math.round((top._sum.cents ?? 0) / top._count._all) : 0,
      firstOrderAt: iso(firstTop?.createdAt && firstOpen?.createdAt ? (firstTop.createdAt < firstOpen.createdAt ? firstTop.createdAt : firstOpen.createdAt) : (firstTop?.createdAt ?? firstOpen?.createdAt)),
      lastOrderAt: iso(later(top?._max.createdAt, op?._max.createdAt, si?._max.createdAt)),
      balanceBits: t.wallets.get(id)?.balance ?? 0,
      paidBits: kind("TOPUP"),
      bonusBits: kind("BONUS"),
      rewardBits: kind("REWARD"),
      packBits: -kind("PACK"),
      singleBits: -kind("SINGLE"),
      buybackBits: kind("BUYBACK"),
      vaultCards: t.vault.get(id) ?? 0,
      shipments: shipments.length,
    },
    addresses,
    firstVisit: firstVisit
      ? { at: firstVisit.startedAt.toISOString(), source: firstVisit.source, sourceName: firstVisit.sourceName, campaign: firstVisit.utmCampaign, landingPath: firstVisit.landingPath, referrer: firstVisit.referrerHost }
      : null,
    lastSeen: lastVisit ? { at: lastVisit.startedAt.toISOString(), device: lastVisit.device, region: lastVisit.region, country: lastVisit.country } : null,
    club: club ? { tier: club.tier, status: club.status, renewsAt: iso(club.currentPeriodEnd), since: club.createdAt.toISOString() } : null,
    orders: orders.orders,
  };
}

export class RecordError extends Error {}

/** Staff edits: tags, note, and unsubscribe on the customer's request. */
export async function updateCustomerRecord(db: PrismaClient, id: string, input: { tags?: unknown; note?: unknown; unsubscribe?: unknown }) {
  const c = await db.siteCustomer.findUnique({ where: { id }, select: { id: true } });
  if (!c) throw new RecordError("No such customer.");
  const data: { tags?: string[]; staffNote?: string | null } = {};
  if (input.tags !== undefined) data.tags = normalizeTags(input.tags);
  if (input.note !== undefined) data.staffNote = String(input.note ?? "").trim().slice(0, 2000) || null;
  if (Object.keys(data).length) await db.siteCustomer.update({ where: { id }, data });
  if (input.unsubscribe !== undefined) {
    if (input.unsubscribe !== "email" && input.unsubscribe !== "sms") throw new RecordError("Choose email or SMS.");
    await leave(db, c, input.unsubscribe, new Date(), "staff");
  }
  return customerRecord(db, id);
}
