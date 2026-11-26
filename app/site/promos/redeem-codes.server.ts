// Redeem codes (Trevor 2026-11-26). A single-use code adds a fixed number of promotional Cardbits (ledger kind
// BONUS) with no purchase. Codes belong to a campaign (the code's prefix); an account can redeem one code per
// campaign. First campaign: PCBF, Poke-Collect Black Friday, 1,000 Cardbits. Poke-Collect gets the codes as a CSV
// from Card Broker and emails one to each qualifying customer; nothing here talks to Poke-Collect.
//
// Codes are PREFIX-XXXXXXXX from a 31-letter alphabet without look-alikes (0/O, 1/I/L), about 40 bits each from
// crypto randomness. Entries are matched ignoring case, spaces and dashes. Wrong guesses are rate limited.
import { randomInt } from "node:crypto";
import { Prisma, type PrismaClient, type SiteCustomer } from "@prisma/client";
import { applyLedger } from "../core/ledger.server";

type Db = PrismaClient | Prisma.TransactionClient;

export const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LEN = 8;
export const MAX_BATCH = 2000;
const TZ = "America/Chicago";

export class RedeemError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
    this.name = "RedeemError";
  }
}

/** Upper case, letters and digits only ("pcbf-ab cd 2345" → "PCBFABCD2345"). */
export const compactCode = (raw: unknown) => String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40);

export function newCode(prefix: string) {
  let s = "";
  for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}-${s}`;
}

/** "January 31, 2027 at 11:59 PM CT" */
export function fmtExpiry(d: Date) {
  const day = d.toLocaleDateString("en-US", { timeZone: TZ, month: "long", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  return `${day} at ${time} CT`;
}

/** What a customer sees before redeeming (the campaign's reward and deadline), or null for an unknown code. */
export async function previewCode(db: Db, raw: unknown) {
  const compact = compactCode(raw);
  if (compact.length < 6) return null;
  const row = await db.siteRedeemCode.findUnique({ where: { compact } });
  if (!row) return null;
  const c = await db.siteRedeemCampaign.findUnique({ where: { key: row.campaign } });
  if (!c) return null;
  return { code: row.code, name: c.name, bits: c.bits, expiresAt: c.expiresAt };
}

export type RedeemResult = { code: string; campaign: string; name: string; bits: number; expiresAt: Date | null; already: boolean };

/**
 * Redeem one code for this customer. Credits the campaign's Cardbits once (idempotent per code); entering a code
 * you already redeemed returns already: true and credits nothing. Throws RedeemError with a customer-facing reason.
 */
export async function redeemCode(db: PrismaClient, customer: Pick<SiteCustomer, "id" | "frozenAt" | "closedAt">, raw: unknown, now = new Date()): Promise<RedeemResult> {
  const compact = compactCode(raw);
  if (!compact) throw new RedeemError("Enter Your Code.", 400);
  if (customer.frozenAt || customer.closedAt) throw new RedeemError("This Account Can't Redeem Codes Right Now. Contact Support@cardbit.com.", 403);
  try {
    return await db.$transaction(async (tx) => {
      const row = await tx.siteRedeemCode.findUnique({ where: { compact } });
      if (!row || row.voidedAt) throw new RedeemError("That Code Isn't Valid. Check It and Try Again.");
      const c = await tx.siteRedeemCampaign.findUnique({ where: { key: row.campaign } });
      if (!c) throw new RedeemError("That Code Isn't Valid. Check It and Try Again.");
      const out = { code: row.code, campaign: c.key, name: c.name, bits: c.bits, expiresAt: c.expiresAt };
      if (row.redeemedBy === customer.id) return { ...out, already: true };
      if (row.redeemedBy) throw new RedeemError("That Code Has Already Been Used.");
      if (!c.active) throw new RedeemError("That Code Isn't Active Right Now.");
      if (c.expiresAt && now >= c.expiresAt) throw new RedeemError(`That Code Expired on ${fmtExpiry(c.expiresAt)}.`);
      const mine = await tx.siteRedeemCode.findFirst({ where: { campaign: c.key, redeemedBy: customer.id }, select: { code: true } });
      if (mine) throw new RedeemError(`Your Account Already Redeemed a ${c.name} Code (${mine.code}). It's One Per Account.`);
      const claimed = await tx.siteRedeemCode.updateMany({
        where: { compact, redeemedBy: null, voidedAt: null },
        data: { redeemedBy: customer.id, redeemedAt: now },
      });
      if (claimed.count !== 1) throw new RedeemError("That Code Has Already Been Used.");
      await applyLedger(tx, {
        customerId: customer.id,
        delta: c.bits,
        kind: "BONUS",
        idempotencyKey: "redeem:" + row.code,
        ref: "redeem:" + c.key,
        note: `${c.name} Code ${row.code}`,
      });
      return { ...out, already: false };
    });
  } catch (e) {
    // Two codes from the same campaign redeemed at the same moment: the (campaign, redeemedBy) unique index stops the second.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      throw new RedeemError("Your Account Already Redeemed a Code From This Promotion. It's One Per Account.");
    throw e;
  }
}

// ---------- Staff (Card Broker Marketing tab, through /internal/site-redeem-codes) ----------

export async function listCampaigns(db: PrismaClient) {
  const [campaigns, stats] = await Promise.all([
    db.siteRedeemCampaign.findMany({ orderBy: { createdAt: "asc" } }),
    db.siteRedeemCode.groupBy({
      by: ["campaign"],
      _count: { _all: true, redeemedBy: true, voidedAt: true },
    }),
  ]);
  const by = new Map(stats.map((s) => [s.campaign, s._count]));
  return campaigns.map((c) => {
    const s = by.get(c.key);
    return {
      key: c.key,
      name: c.name,
      bits: c.bits,
      expiresAt: c.expiresAt?.toISOString() ?? null,
      active: c.active,
      note: c.note,
      codes: s?._all ?? 0,
      redeemed: s?.redeemedBy ?? 0,
      voided: s?.voidedAt ?? 0,
      bitsGiven: (s?.redeemedBy ?? 0) * c.bits,
    };
  });
}

async function campaignOrThrow(db: Db, key: unknown) {
  const c = await db.siteRedeemCampaign.findUnique({ where: { key: String(key ?? "").toUpperCase() } });
  if (!c) throw new RedeemError("No such campaign.");
  return c;
}

/** Make `count` new unused codes for a campaign. Returns the codes (for the CSV). */
export async function generateCodes(db: PrismaClient, key: unknown, count: unknown, actor: string | null, now = new Date()) {
  const c = await campaignOrThrow(db, key);
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > MAX_BATCH) throw new RedeemError(`Make 1 to ${MAX_BATCH.toLocaleString("en-US")} codes at a time.`);
  const batch = `${now.toISOString().slice(0, 16).replace("T", " ")} UTC · ${n} · ${actor ?? "staff"}`.slice(0, 190);
  const made = new Set<string>();
  while (made.size < n) made.add(newCode(c.key));
  const rows = [...made].map((code) => ({ code, compact: compactCode(code), campaign: c.key, batch, createdBy: actor }));
  const res = await db.siteRedeemCode.createMany({ data: rows, skipDuplicates: true });
  // A collision with an existing code (vanishingly rare) is skipped; report only the codes that were stored.
  const stored = res.count === rows.length ? rows.map((r) => r.code) : (await db.siteRedeemCode.findMany({ where: { batch }, select: { code: true } })).map((r) => r.code);
  return { campaign: c.key, batch, codes: stored };
}

/** Every code in a campaign with who redeemed it and when (unused first, newest batch first). */
export async function listCodes(db: PrismaClient, key: unknown, opts: { status?: unknown; q?: unknown } = {}) {
  const c = await campaignOrThrow(db, key);
  const status = String(opts.status ?? "all");
  const q = compactCode(opts.q);
  const where: Prisma.SiteRedeemCodeWhereInput = {
    campaign: c.key,
    ...(status === "unused" ? { redeemedBy: null, voidedAt: null } : status === "redeemed" ? { redeemedBy: { not: null } } : status === "voided" ? { voidedAt: { not: null } } : {}),
    ...(q ? { compact: { contains: q } } : {}),
  };
  const rows = await db.siteRedeemCode.findMany({ where, orderBy: [{ createdAt: "desc" }, { code: "asc" }], take: 20000 });
  const ids = [...new Set(rows.map((r) => r.redeemedBy).filter((x): x is string => !!x))];
  const people = ids.length ? await db.siteCustomer.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }) : [];
  const email = new Map(people.map((p) => [p.id, p.email]));
  return {
    campaign: c.key,
    codes: rows.map((r) => ({
      code: r.code,
      batch: r.batch,
      createdAt: r.createdAt.toISOString(),
      status: r.voidedAt ? "Voided" : r.redeemedBy ? "Redeemed" : "Unused",
      redeemedAt: r.redeemedAt?.toISOString() ?? null,
      customerId: r.redeemedBy,
      email: r.redeemedBy ? email.get(r.redeemedBy) ?? null : null,
    })),
  };
}

/** Change a campaign's name, Cardbits per code (only before any redemption), expiry or on/off. */
export async function saveCampaign(db: PrismaClient, input: { key?: unknown; name?: unknown; bits?: unknown; expiresAt?: unknown; active?: unknown; note?: unknown }) {
  const c = await campaignOrThrow(db, input.key);
  const data: Prisma.SiteRedeemCampaignUpdateInput = {};
  if (input.name !== undefined) {
    const name = String(input.name).trim().slice(0, 80);
    if (!name) throw new RedeemError("Enter a name.");
    data.name = name;
  }
  if (input.bits !== undefined) {
    const bits = Number(input.bits);
    if (!Number.isInteger(bits) || bits < 1 || bits > 100_000) throw new RedeemError("Cardbits per code must be 1 to 100,000.");
    if (bits !== c.bits && (await db.siteRedeemCode.count({ where: { campaign: c.key, redeemedBy: { not: null } } })))
      throw new RedeemError("Codes have been redeemed, so the Cardbits per code can't change.");
    data.bits = bits;
  }
  if (input.expiresAt !== undefined) {
    if (input.expiresAt === null || input.expiresAt === "") data.expiresAt = null;
    else {
      const d = new Date(String(input.expiresAt));
      if (Number.isNaN(d.getTime())) throw new RedeemError("Enter a valid expiry date.");
      data.expiresAt = d;
    }
  }
  if (input.active !== undefined) data.active = input.active === true;
  if (input.note !== undefined) data.note = input.note ? String(input.note).slice(0, 200) : null;
  const saved = await db.siteRedeemCampaign.update({ where: { key: c.key }, data });
  return { key: saved.key };
}

/** Void unused codes (a code sent to the wrong person, a leaked list). Redeemed codes can't be voided. */
export async function voidCodes(db: PrismaClient, codes: unknown, now = new Date()) {
  const list = (Array.isArray(codes) ? codes : [codes]).map(compactCode).filter(Boolean).slice(0, MAX_BATCH);
  if (!list.length) throw new RedeemError("Enter the codes to void.");
  const res = await db.siteRedeemCode.updateMany({ where: { compact: { in: list }, redeemedBy: null, voidedAt: null }, data: { voidedAt: now } });
  return { voided: res.count };
}
