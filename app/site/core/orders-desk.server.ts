// Read-only orders and customers feed for Card Broker's Cardbit workspace (/internal/site-orders).
// Customer data stays minimal: id, email and name; shipments show city/state only.
import type { PrismaClient } from "@prisma/client";

export const ORDER_TYPES = ["PACK", "SINGLE", "BUYBACK", "SHIPPING", "TOPUP"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export type OrderRow = {
  id: string;
  type: OrderType;
  createdAt: string;
  customerId: string;
  email: string | null;
  title: string;
  bits: number | null; // Cardbits moved (spent negative, received positive)
  cents: number | null; // dollars charged, in cents
  status: string;
  demo: boolean;
  detail: string | null;
  image: string | null;
};

export type OrdersQuery = { type?: string; q?: string; before?: string; limit?: number; demo?: "only" | "hide" };

const city = (a: unknown) => {
  const v = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
  return [v.city, v.state].filter((x) => typeof x === "string" && x).join(", ") || null;
};

/** Newest first across every order type. `before` is the createdAt of the last row of the previous page. */
export async function listOrders(db: PrismaClient, query: OrdersQuery) {
  const types = (ORDER_TYPES as readonly string[]).includes(query.type || "") ? [query.type as OrderType] : [...ORDER_TYPES];
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const before = query.before && !Number.isNaN(Date.parse(query.before)) ? new Date(query.before) : undefined;
  const q = (query.q || "").trim().toLowerCase().slice(0, 120);
  const customers = q ? await db.siteCustomer.findMany({ where: { OR: [{ email: { contains: q } }, { name: { contains: q, mode: "insensitive" } }, { id: q }] }, select: { id: true }, take: 500 }) : null;
  const who = customers ? { customerId: { in: customers.map((c) => c.id) } } : {};
  const at = before ? { createdAt: { lt: before } } : {};
  const take = limit + 1;
  const rows: OrderRow[] = [];
  const want = (t: OrderType) => types.includes(t);

  const [openings, ledger, shipments, topups] = await Promise.all([
    want("PACK") ? db.siteOpening.findMany({ where: { ...who, ...at, ...(query.demo === "only" ? { demo: true } : query.demo === "hide" ? { demo: false } : {}) }, orderBy: { createdAt: "desc" }, take }) : [],
    want("SINGLE") || want("BUYBACK")
      ? db.siteLedger.findMany({ where: { ...who, ...at, kind: { in: types.filter((t) => t === "SINGLE" || t === "BUYBACK") } }, orderBy: { createdAt: "desc" }, take })
      : [],
    want("SHIPPING") ? db.siteShipment.findMany({ where: { ...who, ...at }, orderBy: { createdAt: "desc" }, take }) : [],
    want("TOPUP") ? db.siteTopup.findMany({ where: { ...who, ...at }, orderBy: { createdAt: "desc" }, take }) : [],
  ]);
  const packs = new Map((await db.sitePack.findMany({ select: { id: true, title: true } })).map((p) => [p.id, p.title]));
  for (const o of openings)
    rows.push({
      id: o.id,
      type: "PACK",
      createdAt: o.createdAt.toISOString(),
      customerId: o.customerId,
      email: null,
      title: packs.get(o.packId) ?? o.packId,
      bits: -o.priceBits,
      cents: null,
      status: o.reversedAt ? "Reversed" : o.sealed && !o.revealedAt ? "Sealed" : o.revealedAt ? "Opened" : "Opening",
      demo: o.demo,
      detail: null,
      image: null,
    });
  const copyIds = ledger.filter((l) => l.ref).map((l) => l.ref!);
  const copies = new Map((copyIds.length ? await db.siteCopy.findMany({ where: { id: { in: copyIds } }, select: { id: true, image: true, demo: true, title: true } }) : []).map((c) => [c.id, c]));
  for (const l of ledger) {
    const c = l.ref ? copies.get(l.ref) : undefined;
    if (query.demo === "only" && !c?.demo) continue;
    if (query.demo === "hide" && c?.demo) continue;
    rows.push({
      id: l.id,
      type: l.kind as OrderType,
      createdAt: l.createdAt.toISOString(),
      customerId: l.customerId,
      email: null,
      title: c?.title ?? l.note ?? l.kind,
      bits: l.delta,
      cents: null,
      status: "Done",
      demo: Boolean(c?.demo),
      detail: l.note,
      image: c?.image ?? null,
    });
  }
  if (query.demo !== "only")
    for (const s of shipments)
      rows.push({
        id: s.id,
        type: "SHIPPING",
        createdAt: s.createdAt.toISOString(),
        customerId: s.customerId,
        email: null,
        title: `Ship ${s.cardCount} card${s.cardCount === 1 ? "" : "s"}`,
        bits: s.feeBits ? -s.feeBits : null,
        cents: s.feeCents || null,
        status: s.status,
        demo: false,
        detail: [city(s.toAddress), s.carrier && s.trackingNumber ? `${s.carrier} ${s.trackingNumber}` : null].filter(Boolean).join(" · ") || null,
        image: null,
      });
  if (query.demo !== "only")
    for (const t of topups)
      rows.push({
        id: t.id,
        type: "TOPUP",
        createdAt: t.createdAt.toISOString(),
        customerId: t.customerId,
        email: null,
        title: `${(t.baseBits + t.bonusBits).toLocaleString("en-US")} Cardbits`,
        bits: t.baseBits + t.bonusBits,
        cents: t.cents,
        status: t.status,
        demo: false,
        detail: `${t.provider}${t.bonusBits ? ` · ${t.bonusBits.toLocaleString("en-US")} bonus` : ""}`,
        image: null,
      });
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
  const page = rows.slice(0, limit);
  const emails = new Map((await db.siteCustomer.findMany({ where: { id: { in: [...new Set(page.map((r) => r.customerId))] } }, select: { id: true, email: true } })).map((c) => [c.id, c.email]));
  for (const r of page) r.email = emails.get(r.customerId) ?? null;
  return { orders: page, next: rows.length > limit ? page[page.length - 1].createdAt : null };
}

/** Customers newest first with balance and lifetime totals. */
export async function listCustomers(db: PrismaClient, query: { q?: string; before?: string; limit?: number }) {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const q = (query.q || "").trim().toLowerCase().slice(0, 120);
  const before = query.before && !Number.isNaN(Date.parse(query.before)) ? new Date(query.before) : undefined;
  const rows = await db.siteCustomer.findMany({
    where: { ...(q ? { OR: [{ email: { contains: q } }, { name: { contains: q, mode: "insensitive" } }] } : {}), ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: { id: true, email: true, name: true, frozenAt: true, closedAt: true, createdAt: true },
  });
  const page = rows.slice(0, limit);
  const ids = page.map((c) => c.id);
  const [wallets, opens, vault, topups] = await Promise.all([
    db.siteWallet.findMany({ where: { customerId: { in: ids } } }),
    db.siteOpening.groupBy({ by: ["customerId"], where: { customerId: { in: ids } }, _count: { _all: true }, _sum: { priceBits: true } }),
    db.siteCopy.groupBy({ by: ["ownerId"], where: { ownerId: { in: ids }, status: "VAULTED" }, _count: { _all: true } }),
    db.siteTopup.groupBy({ by: ["customerId"], where: { customerId: { in: ids }, status: "CREDITED" }, _sum: { cents: true } }),
  ]);
  const total = await db.siteCustomer.count();
  return {
    total,
    customers: page.map((c) => ({
      id: c.id,
      email: c.email,
      name: c.name,
      status: c.closedAt ? "Closed" : c.frozenAt ? "Frozen" : "Active",
      createdAt: c.createdAt.toISOString(),
      balanceBits: wallets.find((w) => w.customerId === c.id)?.balance ?? 0,
      packsOpened: opens.find((o) => o.customerId === c.id)?._count._all ?? 0,
      packBits: opens.find((o) => o.customerId === c.id)?._sum.priceBits ?? 0,
      vaultCards: vault.find((v) => v.ownerId === c.id)?._count._all ?? 0,
      toppedUpCents: topups.find((t) => t.customerId === c.id)?._sum.cents ?? 0,
    })),
    next: rows.length > limit ? page[page.length - 1].createdAt.toISOString() : null,
  };
}
