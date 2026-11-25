// Store API for the standalone site: the server-side twin of the theme adapter's view()/actions.
// Balances live in SiteLedger, physical cards in SiteCopy. Every paid action is idempotent per
// (customer, requestId) and runs in one transaction with the ledger debit.
import { createHash, randomInt } from "node:crypto";
import type { Prisma, PrismaClient, SiteCopy, SiteCustomer } from "@prisma/client";
import { applyLedger, balanceOf, InsufficientCardbits } from "../core/ledger.server";
import { priceKey } from "../core/stock.server";
import { AGE_REQUIRED, ageConfirmed } from "../../lib/cardbit-age.server";

/** Shop key for site rows in shared Cardbit* tables (age, rewards, vault marks). */
export const SITE_SHOP_KEY = "cardbit-site";
const pk = (c: Pick<SiteCopy, "printingKey" | "condition">) => priceKey(c.printingKey, c.condition);

type Tx = Prisma.TransactionClient;

export class StoreError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) {
    super(message);
    this.name = "StoreError";
  }
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export const singleKey = (c: Pick<SiteCopy, "printingKey" | "condition">) =>
  "s_" + createHash("sha256").update(`${c.printingKey}|${c.condition}`).digest("hex").slice(0, 20);

type Price = { retailBits: number | null; buybackBits: number | null };
type Prices = Map<string, Price>;

async function pricesFor(db: PrismaClient | Tx, keys: string[]): Promise<Prices> {
  if (!keys.length) return new Map();
  const rows = await db.sitePrice.findMany({ where: { printingKey: { in: [...new Set(keys)] } } });
  return new Map(rows.map((r) => [r.printingKey, { retailBits: r.retailBits, buybackBits: r.buybackBits }]));
}

export type TierRule = { name: string; min: number };
/** Default ladder (Cardbits of card value; 100 = $1) until staff set per-pack rules. */
export const DEFAULT_TIERS: TierRule[] = [
  { name: "Common", min: 0 },
  { name: "Uncommon", min: 500 },
  { name: "Rare", min: 1500 },
  { name: "Epic", min: 5000 },
  { name: "Legendary", min: 15000 },
];
export function tierRules(raw: unknown): TierRule[] {
  if (!Array.isArray(raw)) return DEFAULT_TIERS;
  const rules = raw.filter((r): r is TierRule => typeof r?.name === "string" && Number.isFinite(r?.min)).sort((a, b) => a.min - b.min);
  return rules.length ? rules : DEFAULT_TIERS;
}
export function tierFor(valueBits: number | null, rules: TierRule[] = DEFAULT_TIERS): string | null {
  if (valueBits == null) return null;
  let tier: string | null = null;
  for (const r of rules) if (valueBits >= r.min) tier = r.name;
  return tier;
}

/** Card fields the storefront reads (same names as the theme catalog). */
function cardView(c: SiteCopy, p: Price | undefined, id: string, rules: TierRule[] = DEFAULT_TIERS) {
  const retail = c.retailBits ?? p?.retailBits ?? null;
  const buyback = p?.buybackBits ?? null;
  const tier = tierFor(retail ?? buyback, rules);
  return {
    id,
    name: c.name,
    title: c.title,
    set: c.setName,
    number: c.number,
    printing: c.finish,
    condition: c.condition,
    language: c.language,
    game: c.game,
    image: c.image,
    rarity: null as string | null,
    tier,
    priceBits: retail,
    retailBits: retail,
    buybackBits: buyback,
    canBuyback: buyback != null,
    cardbitValue: buyback ?? retail ?? 0,
    catalogId: c.tcgplayerId ? String(c.tcgplayerId) : null,
    editionId: c.packId,
  };
}

export async function storeState(db: PrismaClient, customer: SiteCustomer | null) {
  const [packs, pooled, forSale] = await Promise.all([
    db.sitePack.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.siteCopy.findMany({ where: { status: "POOLED", packId: { not: null } } }),
    db.siteCopy.findMany({ where: { status: "FOR_SALE" }, orderBy: { createdAt: "asc" } }),
  ]);
  const owned = customer
    ? await db.siteCopy.findMany({ where: { ownerId: customer.id, status: { in: ["VAULTED", "SHIP_LOCKED", "SHIPPED"] } }, orderBy: { updatedAt: "desc" } })
    : [];
  const prices = await pricesFor(db, [...pooled, ...forSale, ...owned].map(pk));

  const packViews = packs.map((p) => {
    const pool = pooled.filter((c) => c.packId === p.id);
    const n = pool.length;
    return {
      id: p.id,
      title: p.title,
      priceBits: p.priceBits,
      cardsPerPack: p.cardsPerPack,
      cardIds: pool.map((c) => c.id),
      remaining: Math.floor(n / p.cardsPerPack),
      remainingCards: n,
      drawModel: "uniform-without-replacement",
      cards: pool.map((c) => ({ ...cardView(c, prices.get(pk(c)), c.id, tierRules(p.tierRules)), remaining: 1, chanceInPack: n >= p.cardsPerPack ? p.cardsPerPack / n : 0 })),
    };
  });

  const groups = new Map<string, { copy: SiteCopy; available: number }>();
  for (const c of forSale) {
    const k = singleKey(c);
    const g = groups.get(k);
    if (g) g.available++;
    else groups.set(k, { copy: c, available: 1 });
  }
  const singles = [...groups.entries()]
    .map(([k, g]) => ({ ...cardView(g.copy, prices.get(pk(g.copy)), k), editionId: null, available: g.available }))
    .filter((c) => c.priceBits != null && c.priceBits > 0);

  if (!customer) {
    return { site: true, account: null, packs: packViews, singles, binder: [], openings: [], wants: [], shipments: [], history: [], orders: [] };
  }

  const [openings, wants, ledger, shipments, balance] = await Promise.all([
    db.siteOpening.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.siteWant.findMany({ where: { customerId: customer.id } }),
    db.siteLedger.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: "desc" }, take: 300 }),
    db.siteShipment.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: "desc" }, take: 100, include: { items: true } }),
    balanceOf(db, customer.id),
  ]);
  const shipmentOf = new Map<string, string>();
  for (const s of shipments) if (s.status !== "CANCELED") for (const i of s.items) shipmentOf.set(i.copyId, s.id);
  const sealed = new Set(openings.filter((o) => o.sealed).map((o) => o.id));
  // Copies from pack openings may have been sold back since; keep the opening record intact.
  const openingCopies = await db.siteCopy.findMany({ where: { openingId: { in: openings.map((o) => o.id) } }, orderBy: { position: "asc" } });
  const openingPrices = await pricesFor(db, openingCopies.map(pk));
  // Tier ladder per opening = its pack's rules (inactive packs too, so old pulls keep their tier).
  const allPacks = await db.sitePack.findMany({ select: { id: true, tierRules: true } });
  const packRules = new Map(allPacks.map((p) => [p.id, tierRules(p.tierRules)]));
  const openingPack = new Map(openings.map((o) => [o.id, o.packId]));
  const rulesFor = (c: SiteCopy) => packRules.get((c.openingId && openingPack.get(c.openingId)) || c.packId || "") ?? DEFAULT_TIERS;
  const copyView = (c: SiteCopy, p: Prices) => ({
    ...cardView(c, p.get(pk(c)), c.id, rulesFor(c)),
    physicalCopyId: singleKey(c),
    cardId: singleKey(c),
    status: c.ownerId === customer.id ? (c.status === "VAULTED" ? "held" : c.status === "SHIP_LOCKED" ? "shipping" : c.status === "SHIPPED" ? "shipped" : "returned") : "returned",
    openingId: c.openingId,
    position: c.position,
    shipRequestId: shipmentOf.get(c.id) ?? null,
    at: c.updatedAt.toISOString(),
    acquiredAt: c.updatedAt.toISOString(),
  });

  return {
    site: true,
    account: { id: customer.id, name: customer.name || customer.email.split("@")[0], email: customer.email, bits: balance, frozen: Boolean(customer.frozenAt) },
    packs: packViews,
    singles,
    binder: owned.filter((c) => !c.openingId || !sealed.has(c.openingId)).map((c) => copyView(c, prices)),
    openings: openings.map((o) => {
      const cards = openingCopies.filter((c) => c.openingId === o.id);
      return {
        id: o.id,
        packId: o.packId,
        at: o.createdAt.toISOString(),
        createdAt: o.createdAt.toISOString(),
        sealed: o.sealed,
        cardCount: cards.length,
        cards: o.sealed ? [] : cards.map((c) => copyView(c, openingPrices)),
      };
    }),
    wants: wants.map((w) => w.cardKey),
    shipments: shipments.map((s) => {
      const to = s.toAddress as { city?: string; state?: string } | null;
      return {
        id: s.id,
        at: s.createdAt.toISOString(),
        status: s.status.toLowerCase(),
        destination: [to?.city, to?.state].filter(Boolean).join(", "),
        rateCents: s.feeCents,
        feeBits: s.feeBits,
        feeKind: s.feeKind,
        copyIds: s.items.map((i) => i.copyId),
        tracking: s.trackingNumber ? { number: s.trackingNumber, url: s.trackingUrl, carrier: s.carrier } : null,
      };
    }),
    history: ledger.map((l) => ({ id: l.id, at: l.createdAt.toISOString(), label: l.note || l.kind, delta: l.delta, kind: l.kind })),
    orders: ledger
      .filter((l) => l.kind === "PACK" || l.kind === "SINGLE")
      .map((l) => ({ id: l.ref || l.id, at: l.createdAt.toISOString(), label: l.note || l.kind, status: "Paid", amount: -l.delta })),
  };
}

export type StoreAction = {
  action: string;
  requestId: string;
  id?: string;
  amount?: number;
  openLater?: boolean;
  copyIds?: string[];
};

type Result = Record<string, unknown>;

function fingerprintOf(a: StoreAction) {
  return createHash("sha256")
    .update(JSON.stringify([a.action, a.id ?? null, a.amount ?? null, a.openLater === true, a.copyIds ? [...a.copyIds].sort() : null]))
    .digest("hex");
}

/** Uniform draw without replacement. */
export function drawCopies<T>(pool: T[], count: number, rand: (n: number) => number = randomInt): T[] {
  const left = pool.slice();
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(left.splice(rand(left.length), 1)[0]);
  return out;
}

async function lockKey(tx: Tx, key: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
}

export async function storeAction(db: PrismaClient, customer: SiteCustomer, a: StoreAction): Promise<Result> {
  if (!a || typeof a.action !== "string" || typeof a.requestId !== "string" || !UUID.test(a.requestId))
    throw new StoreError("invalid", "Review this action again.", 400);
  if (a.id !== undefined && (typeof a.id !== "string" || a.id.length > 300)) throw new StoreError("invalid", "Review this action again.", 400);
  const paid = ["open", "buy", "buyback"].includes(a.action);
  if (paid && (customer.frozenAt || customer.closedAt))
    throw new StoreError("account_frozen", "This account is on hold. Contact Support@cardbit.com.", 403);
  // 18+ only: buying packs or singles needs a recorded age confirmation (sign-up checkbox or prompt).
  if ((a.action === "open" || a.action === "buy") && !(await ageConfirmed(db, SITE_SHOP_KEY, customer.id)))
    throw new StoreError(AGE_REQUIRED.code, AGE_REQUIRED.error, 403);
  const reqId = `${customer.id}:${a.requestId}`;
  const fingerprint = fingerprintOf(a);
  const key = `req:${reqId}`;

  return db.$transaction(
    async (tx) => {
      await lockKey(tx, `site-customer:${customer.id}`);
      const prior = await tx.siteRequest.findUnique({ where: { id: reqId } });
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new StoreError("conflict", "This confirmation belongs to a different action.");
        return prior.result as Result;
      }
      let result: Result = {};
      const debit = async (bits: number, kind: "PACK" | "SINGLE", ref: string, note: string) => {
        try {
          await applyLedger(tx, { customerId: customer.id, delta: -bits, kind, idempotencyKey: key, ref, note });
        } catch (e) {
          if (e instanceof InsufficientCardbits) throw new StoreError("insufficient_bits", "Add Cardbits before confirming this purchase.");
          throw e;
        }
      };

      if (a.action === "open") {
        const pack = await tx.sitePack.findFirst({ where: { id: a.id || "", active: true } });
        if (!pack) throw new StoreError("not_found", "This edition is unavailable.", 404);
        await lockKey(tx, `site-pack:${pack.id}`);
        const pool = await tx.siteCopy.findMany({ where: { packId: pack.id, status: "POOLED" }, orderBy: { id: "asc" } });
        if (pool.length < pack.cardsPerPack) throw new StoreError("sold_out", "This pack has sold out.");
        const opening = await tx.siteOpening.create({
          data: { customerId: customer.id, packId: pack.id, priceBits: pack.priceBits, sealed: a.openLater === true, revealedAt: a.openLater === true ? null : new Date() },
        });
        await debit(pack.priceBits, "PACK", opening.id, `${pack.title}`);
        const prices = await pricesFor(tx, pool.map(pk));
        const value = (c: SiteCopy) => c.retailBits ?? prices.get(pk(c))?.retailBits ?? 0;
        const drawn = drawCopies(pool, pack.cardsPerPack).sort((x, y) => value(x) - value(y));
        for (const [i, c] of drawn.entries()) {
          const n = await tx.siteCopy.updateMany({
            where: { id: c.id, status: "POOLED", packId: pack.id },
            data: { status: "VAULTED", ownerId: customer.id, packId: null, openingId: opening.id, position: i + 1, orderId: opening.id },
          });
          if (n.count !== 1) throw new StoreError("retry", "Packs are busy. Try again.");
          await tx.siteCopyEvent.create({ data: { copyId: c.id, fromStatus: "POOLED", toStatus: "VAULTED", actor: `customer:${customer.id}`, reason: `pack opening ${opening.id}` } });
        }
        result = { openingId: opening.id, sealed: opening.sealed };
      } else if (a.action === "reveal") {
        const o = await tx.siteOpening.findFirst({ where: { id: a.id || "", customerId: customer.id } });
        if (!o) throw new StoreError("not_found", "This pack is unavailable.", 404);
        if (o.sealed) await tx.siteOpening.update({ where: { id: o.id }, data: { sealed: false, revealedAt: new Date() } });
        result = { openingId: o.id };
      } else if (a.action === "buy") {
        const forSale = await tx.siteCopy.findMany({ where: { status: "FOR_SALE" }, orderBy: [{ slot: "asc" }, { pocket: "asc" }] });
        const group = forSale.filter((c) => singleKey(c) === a.id);
        if (!group.length) throw new StoreError("sold_out", "This single is no longer available.");
        const pick = group[0];
        await lockKey(tx, `site-copy:${pick.id}`);
        const price = pick.retailBits ?? (await pricesFor(tx, [pk(pick)])).get(pk(pick))?.retailBits ?? null;
        if (!price || price <= 0) throw new StoreError("unpriced", "Price Unavailable.");
        if (typeof a.amount === "number" && a.amount !== price) throw new StoreError("catalog_changed", "The price changed. Review it again.");
        await debit(price, "SINGLE", pick.id, `Purchased ${pick.title}`);
        const n = await tx.siteCopy.updateMany({ where: { id: pick.id, status: "FOR_SALE" }, data: { status: "VAULTED", ownerId: customer.id, orderId: key.slice(0, 190) } });
        if (n.count !== 1) throw new StoreError("sold_out", "This single is no longer available.");
        await tx.siteCopyEvent.create({ data: { copyId: pick.id, fromStatus: "FOR_SALE", toStatus: "VAULTED", actor: `customer:${customer.id}`, reason: `bought for ${price} Cardbits` } });
        result = { copyId: pick.id };
      } else if (a.action === "buyback") {
        const c = await tx.siteCopy.findFirst({ where: { id: a.id || "", ownerId: customer.id } });
        if (!c) throw new StoreError("not_found", "This card could not be found in your vault.", 404);
        if (c.status !== "VAULTED") throw new StoreError("unavailable", "This copy has already been sold back or requested for shipping.");
        if (c.openingId) {
          const o = await tx.siteOpening.findUnique({ where: { id: c.openingId } });
          if (o?.sealed) throw new StoreError("not_found", "Open this pack first.", 404);
        }
        const offer = (await pricesFor(tx, [pk(c)])).get(pk(c))?.buybackBits ?? null;
        if (!offer || offer <= 0) throw new StoreError("no_offer", "No current buyback offer for this copy.");
        if (a.amount !== offer) throw new StoreError("catalog_changed", "The Cardbits offer changed. Review the current price.");
        await applyLedger(tx, { customerId: customer.id, delta: offer, kind: "BUYBACK", idempotencyKey: key, ref: c.id, note: `Sold back ${c.title}` });
        // The card goes back on the shelf for sale, in the same slot.
        await tx.siteCopy.update({ where: { id: c.id }, data: { status: "FOR_SALE", ownerId: null, orderId: null } });
        await tx.siteCopyEvent.create({ data: { copyId: c.id, fromStatus: "VAULTED", toStatus: "FOR_SALE", actor: `customer:${customer.id}`, reason: `buyback ${offer} Cardbits` } });
        result = { copyId: c.id };
      } else if (a.action === "want-add" || a.action === "want-remove") {
        if (!a.id) throw new StoreError("invalid", "Choose a printing.", 400);
        if (a.action === "want-add")
          await tx.siteWant.upsert({ where: { customerId_cardKey: { customerId: customer.id, cardKey: a.id } }, create: { customerId: customer.id, cardKey: a.id }, update: {} });
        else await tx.siteWant.deleteMany({ where: { customerId: customer.id, cardKey: a.id } });
      } else if (a.action === "ship" || a.action === "ship-group") {
        throw new StoreError("shipping_address", "Enter a delivery address on the shipping page.", 400);
      } else {
        throw new StoreError("invalid", "This action is unavailable.", 400);
      }
      await tx.siteRequest.create({ data: { id: reqId, fingerprint, result: result as Prisma.InputJsonValue } });
      return result;
    },
    { timeout: 15_000 },
  );
}

/** Live Pulls feed: recent revealed, paid, non-demo pack pulls. Card fields only, no customer data. */
export async function recentPulls(db: PrismaClient, limit = 12) {
  const take = Math.min(Math.max(Math.floor(limit) || 12, 1), 24);
  const openings = await db.siteOpening.findMany({
    where: { sealed: false, demo: false, revealedAt: { not: null } },
    orderBy: { revealedAt: "desc" },
    take,
    select: { id: true, packId: true, revealedAt: true },
  });
  if (!openings.length) return [];
  const [copies, packs] = await Promise.all([
    db.siteCopy.findMany({ where: { openingId: { in: openings.map((o) => o.id) }, demo: false }, orderBy: { position: "asc" } }),
    db.sitePack.findMany({ where: { id: { in: [...new Set(openings.map((o) => o.packId))] } }, select: { id: true, tierRules: true } }),
  ]);
  const prices = await pricesFor(db, copies.map(pk));
  const rules = new Map(packs.map((p) => [p.id, tierRules(p.tierRules)]));
  const pulls = [];
  for (const o of openings) {
    for (const c of copies.filter((x) => x.openingId === o.id)) {
      const v = cardView(c, prices.get(pk(c)), c.id, rules.get(o.packId) ?? DEFAULT_TIERS);
      pulls.push({ id: c.id, name: v.name, set: v.set, number: v.number, image: v.image, tier: v.tier, packId: o.packId, at: o.revealedAt!.toISOString() });
    }
  }
  return pulls.slice(0, take);
}
