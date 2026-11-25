// Promo codes for Cardbits top-ups (Trevor 2026-11-25). A code adds bonus Cardbits to one top-up.
// The bonus rides in SiteTopup.bonusBits (credited as BONUS, taken back on refund like any bonus) and
// SiteTopup.promoBits records how much of it came from the code. One paid use per customer. A PENDING
// checkout younger than an hour holds a slot in the total cap; starting a new checkout with the same
// code moves the code off the customer's older unpaid checkouts (releasePendingUses).
import type { Prisma, PrismaClient, SitePromoCode } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;
const PAID = ["CREDITED", "CHARGEBACK_WON"];
const HOLD_MS = 60 * 60_000;

export class PromoCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromoCodeError";
  }
}

export const normalizeCode = (raw: unknown) => String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
const VALID = /^[A-Z0-9][A-Z0-9-]{1,31}$/;

export function promoBonus(p: Pick<SitePromoCode, "kind" | "value" | "maxBonusBits">, baseBits: number) {
  const raw = p.kind === "PERCENT" ? Math.floor((baseBits * p.value) / 100) : p.value;
  return Math.max(0, p.maxBonusBits != null ? Math.min(raw, p.maxBonusBits) : raw);
}

/** Uses that are paid or still being paid (pending under an hour). */
function usesWhere(code: string, now: Date): Prisma.SiteTopupWhereInput {
  return {
    promoCode: code,
    OR: [{ status: { in: PAID } }, { status: "PENDING", createdAt: { gte: new Date(now.getTime() - HOLD_MS) } }],
  };
}

/** Take the code off this customer's unpaid checkouts (they're starting a new one with it). */
export async function releasePendingUses(db: Db, code: string, customerId: string) {
  const rows = await db.siteTopup.findMany({ where: { promoCode: code, customerId, status: "PENDING" }, select: { id: true, promoBits: true } });
  for (const r of rows)
    await db.siteTopup.update({ where: { id: r.id }, data: { promoCode: null, promoBits: 0, bonusBits: { decrement: r.promoBits } } });
  return rows.length;
}

/** Checks a code for this customer and top-up and returns the bonus (null when no code), or throws PromoCodeError. */
export async function quotePromo(db: Db, input: { code: unknown; customerId: string; cents: number; baseBits: number; now?: Date }) {
  const code = normalizeCode(input.code);
  if (!code) return null;
  const now = input.now ?? new Date();
  const bad = new PromoCodeError("That promo code isn't valid.");
  if (!VALID.test(code)) throw bad;
  const p = await db.sitePromoCode.findUnique({ where: { code } });
  if (!p || !p.active) throw bad;
  if (p.startsAt && now < p.startsAt) throw new PromoCodeError("That promo code isn't active yet.");
  if (p.endsAt && now >= p.endsAt) throw new PromoCodeError("That promo code has expired.");
  if (p.minCents && input.cents < p.minCents) throw new PromoCodeError(`That promo code needs a top-up of $${(p.minCents / 100).toFixed(0)} or more.`);
  if (await db.siteTopup.count({ where: { promoCode: code, customerId: input.customerId, status: { in: PAID } } })) throw new PromoCodeError("You've already used that promo code.");
  if (p.firstTopupOnly && (await db.siteTopup.count({ where: { customerId: input.customerId, status: { in: PAID } } })))
    throw new PromoCodeError("That promo code is for your first top-up only.");
  const others = { ...usesWhere(code, now), customerId: { not: input.customerId } };
  if (p.maxUses != null && (await db.siteTopup.count({ where: others })) >= p.maxUses) throw new PromoCodeError("That promo code has been fully used.");
  const bonusBits = promoBonus(p, input.baseBits);
  if (bonusBits <= 0) throw bad;
  return { code, bonusBits };
}

// ---------- Staff (Card Broker Marketing tab, through /internal/site-promo-codes) ----------

export type PromoInput = {
  code?: unknown; kind?: unknown; value?: unknown; maxBonusBits?: unknown; maxUses?: unknown; minCents?: unknown;
  firstTopupOnly?: unknown; startsAt?: unknown; endsAt?: unknown; active?: unknown; note?: unknown;
};
const int = (v: unknown, min: number, max: number) => {
  if (v === "" || v == null) return null;
  const x = Number(v);
  if (!Number.isInteger(x) || x < min || x > max) throw new PromoCodeError(`Enter a whole number from ${min} to ${max}.`);
  return x;
};
const date = (v: unknown) => {
  if (v === "" || v == null) return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new PromoCodeError("Enter a valid date.");
  return d;
};
const yes = (v: unknown) => v === true || v === "true" || v === "on";

/** Create a code, or update one (its bonus stays fixed once anyone has used it). */
export async function savePromo(db: PrismaClient, input: PromoInput, actor: string | null) {
  const code = normalizeCode(input.code);
  if (!VALID.test(code)) throw new PromoCodeError("Codes are 2–32 letters, numbers or dashes.");
  const kind = String(input.kind || "").toUpperCase();
  if (kind !== "PERCENT" && kind !== "FLAT") throw new PromoCodeError("Choose Percent or Flat.");
  const value = int(input.value, 1, kind === "PERCENT" ? 100 : 100_000);
  if (value == null) throw new PromoCodeError("Enter the bonus amount.");
  const data = {
    kind,
    value,
    maxBonusBits: kind === "PERCENT" ? int(input.maxBonusBits, 1, 1_000_000) : null,
    maxUses: int(input.maxUses, 1, 1_000_000),
    minCents: int(input.minCents, 0, 1_000_000),
    firstTopupOnly: yes(input.firstTopupOnly),
    startsAt: date(input.startsAt),
    endsAt: date(input.endsAt),
    active: input.active === undefined ? true : yes(input.active),
    note: input.note ? String(input.note).slice(0, 200) : null,
  };
  const existing = await db.sitePromoCode.findUnique({ where: { code } });
  if (existing && (existing.kind !== kind || existing.value !== value) && (await db.siteTopup.count({ where: { promoCode: code } })))
    throw new PromoCodeError("This code has been used, so its bonus can't change. Make a new code instead.");
  return existing ? db.sitePromoCode.update({ where: { code }, data }) : db.sitePromoCode.create({ data: { code, ...data, createdBy: actor } });
}

export async function setPromoActive(db: PrismaClient, code: unknown, active: boolean) {
  const c = normalizeCode(code);
  if (!(await db.sitePromoCode.findUnique({ where: { code: c } }))) throw new PromoCodeError("No such code.");
  return db.sitePromoCode.update({ where: { code: c }, data: { active } });
}

/** Every code with its paid uses, bonus given and the top-up dollars it came with. */
export async function listPromos(db: PrismaClient) {
  const [codes, stats] = await Promise.all([
    db.sitePromoCode.findMany({ orderBy: [{ active: "desc" }, { createdAt: "desc" }] }),
    db.siteTopup.groupBy({ by: ["promoCode"], where: { promoCode: { not: null }, status: { in: PAID } }, _count: { _all: true }, _sum: { promoBits: true, cents: true } }),
  ]);
  const by = new Map(stats.map((s) => [s.promoCode, s]));
  return codes.map((c) => {
    const s = by.get(c.code);
    return {
      ...c,
      startsAt: c.startsAt?.toISOString() ?? null,
      endsAt: c.endsAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      uses: s?._count._all ?? 0,
      bonusBits: s?._sum.promoBits ?? 0,
      cents: s?._sum.cents ?? 0,
    };
  });
}
