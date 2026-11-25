// Coming-soon waitlist for cardbit.com (Trevor, Nov 25 2026).
//
// Everyone who joins is a Founding Collector: a badge, plus 1,000 Cardbits (400 for email, 600 for a
// phone number that confirms) that UNLOCK WITH THE FIRST TOP-UP on a Cardbit account using the same
// email (Trevor's decision card, Nov 25 1:57 PM CT). The founding bonus replaces the regular Welcome
// Rewards (200 email + 300 text) for these people: whatever Welcome Rewards already paid is subtracted,
// so a Founding Collector gets 1,000 in total, never 1,500.
//
// Abuse limits: one bonus per normalized email (Gmail dots and +tags removed), one per phone number,
// disposable email domains refused, a per-IP signup cap, a honeypot field, and nothing is paid until a
// processor-confirmed payment. A refund or chargeback of the unlocking top-up takes the bonus back.
import type { Prisma, PrismaClient, SiteTopup } from "@prisma/client";
import { applyLedger, balanceOf } from "../core/ledger.server";
import { usPhone } from "../promos/promos.server";

type Tx = Prisma.TransactionClient;

export const FOUNDING = { email: 400, sms: 600 } as const;
export const FOUNDING_TOTAL = FOUNDING.email + FOUNDING.sms;
export const FOUNDING_TAG = "founding-collector";
export const WAITLIST_TERMS = "waitlist-2026-11-25";
const WELCOME_PAID = { email: 200, sms: 300 } as const; // promos.server WELCOME; kept here so the math is visible
const IP_HOURLY_CAP = 5;

export const waitlistOn = (env: NodeJS.ProcessEnv = process.env) => env.CARDBIT_WAITLIST === "on";

export class WaitlistError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "invalid") {
    super(message);
  }
}

// Throwaway inbox providers. Short on purpose: the per-IP cap and the first-top-up unlock do the heavy lifting.
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "grr.la", "10minutemail.com",
  "10minutemail.net", "tempmail.com", "temp-mail.org", "temp-mail.io", "tempmail.net", "tempmailo.com",
  "throwawaymail.com", "yopmail.com", "yopmail.net", "getnada.com", "nada.email", "dispostable.com",
  "maildrop.cc", "mailnesia.com", "trashmail.com", "trashmail.de", "fakeinbox.com", "mintemail.com",
  "mohmal.com", "emailondeck.com", "spamgourmet.com", "mailcatch.com", "inboxkitten.com", "burnermail.io",
  "tmail.ws", "tmpmail.org", "tmpmail.net", "moakt.com", "mail.tm", "mail.gw", "discard.email",
  "spambox.us", "fakemail.net", "luxusmail.org", "1secmail.com", "1secmail.org", "1secmail.net",
  "emltmp.com", "minuteinbox.com", "byom.de", "trash-mail.com", "dropmail.me", "33mail.com",
]);

/** Lowercased address and its duplicate-check key (Gmail ignores dots; +tags are removed everywhere). */
export function emailKeyOf(input: unknown): { email: string; key: string; domain: string } | null {
  const email = String(input ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/.test(email)) return null;
  const at = email.lastIndexOf("@");
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  local = local.split("+")[0];
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  if (!local) return null;
  return { email, key: `${local}@${domain}`, domain };
}

export const isDisposable = (domain: string) =>
  DISPOSABLE.has(domain) || [...DISPOSABLE].some((d) => domain.endsWith("." + d));

export type JoinInput = {
  email?: unknown;
  phone?: unknown;
  emailConsent?: unknown;
  smsConsent?: unknown;
  /** Honeypot: a hidden field people never fill in. */
  company?: unknown;
  source?: unknown;
};
export type JoinCtx = { ip?: string | null; userAgent?: string | null; now?: Date };
export type JoinResult = { status: "joined" | "updated" | "already"; phoneSaved: boolean; phoneTaken?: boolean };

function cleanSource(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "referrer", "fbclid", "ttclid", "gclid"]) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 200);
  }
  return Object.keys(out).length ? out : null;
}

/** Add someone to the waitlist, or add a phone number to their existing spot. */
export async function joinWaitlist(db: PrismaClient, input: JoinInput, ctx: JoinCtx = {}): Promise<JoinResult> {
  const now = ctx.now ?? new Date();
  // Bots fill every field; answer like a success so they learn nothing.
  if (typeof input.company === "string" && input.company.trim()) return { status: "joined", phoneSaved: false };
  const parsed = emailKeyOf(input.email);
  if (!parsed) throw new WaitlistError("Enter a Valid Email Address.");
  if (isDisposable(parsed.domain)) throw new WaitlistError("Please Use a Permanent Email Address.");
  if (input.emailConsent !== true) throw new WaitlistError("Check the Box to Join the List and Get Cardbit Emails.");
  const wantsPhone = String(input.phone ?? "").trim() !== "";
  const phone = wantsPhone ? usPhone(input.phone) : null;
  if (wantsPhone && !phone) throw new WaitlistError("Enter a 10-Digit US Mobile Number, or Leave It Blank.");
  if (phone && input.smsConsent !== true) throw new WaitlistError("Check the Text Alerts Box to Add Your Phone Number.");

  if (ctx.ip) {
    const recent = await db.siteWaitlist.count({ where: { ip: ctx.ip, createdAt: { gte: new Date(now.getTime() - 3600_000) } } });
    if (recent >= IP_HOURLY_CAP) throw new WaitlistError("Too Many Signups From This Network. Try Again in an Hour.", 429, "rate_limited");
  }

  const existing = await db.siteWaitlist.findUnique({ where: { emailKey: parsed.key } });
  const phoneOwner = phone ? await db.siteWaitlist.findUnique({ where: { phone } }) : null;
  const phoneTaken = !!phoneOwner && phoneOwner.emailKey !== parsed.key;
  const usePhone = phone && !phoneTaken ? phone : null;

  if (existing) {
    if (usePhone && existing.phone !== usePhone && !existing.smsBonusAt) {
      await db.siteWaitlist.update({ where: { id: existing.id }, data: { phone: usePhone, smsConsentAt: now, syncedAt: null, smsSyncedAt: null } });
      return { status: "updated", phoneSaved: true };
    }
    return { status: "already", phoneSaved: !!existing.phone, ...(phoneTaken ? { phoneTaken } : {}) };
  }
  try {
    await db.siteWaitlist.create({
      data: {
        emailKey: parsed.key,
        email: parsed.email,
        phone: usePhone,
        smsConsentAt: usePhone ? now : null,
        emailConsentAt: now,
        termsVersion: WAITLIST_TERMS,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent?.slice(0, 300) ?? null,
        source: cleanSource(input.source) ?? undefined,
      },
    });
  } catch (e) {
    // Two taps at once: the second one finds the first row.
    if ((e as { code?: string }).code === "P2002") return { status: "already", phoneSaved: !!usePhone };
    throw e;
  }
  return { status: "joined", phoneSaved: !!usePhone, ...(phoneTaken ? { phoneTaken } : {}) };
}

/** The waitlist spot that belongs to this account's email, if any. */
export async function foundingRow(db: PrismaClient | Tx, email: string) {
  const parsed = emailKeyOf(email);
  return parsed ? db.siteWaitlist.findUnique({ where: { emailKey: parsed.key } }) : null;
}

/** For the account pages: badge + bonus status. */
export async function foundingView(db: PrismaClient, customer: { id: string; email: string }) {
  const row = await foundingRow(db, customer.email);
  if (!row || (row.customerId && row.customerId !== customer.id)) return null;
  return {
    badge: "Founding Collector",
    bonus: FOUNDING_TOTAL,
    amounts: FOUNDING,
    emailCredited: !!row.emailBonusAt,
    smsCredited: !!row.smsBonusAt,
    unlocksWith: "first-topup" as const,
  };
}

async function welcomePaid(tx: Tx, customerId: string, channel: "email" | "sms") {
  const row = await tx.siteLedger.findUnique({ where: { idempotencyKey: `welcome:${channel}:${customerId}` } });
  return row ? Math.min(row.delta, WELCOME_PAID[channel]) : 0;
}

/**
 * Pay whatever founding bonus is now due. Call inside the transaction that credits a top-up, and after a
 * phone number confirms. Needs: a waitlist spot for this email, not claimed by another account, an open
 * account, and at least one credited (processor-confirmed) top-up. Idempotent.
 */
export async function settleFounding(tx: Tx, customerId: string, opts: { topupId?: string | null; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const customer = await tx.siteCustomer.findUnique({ where: { id: customerId } });
  if (!customer || customer.closedAt || customer.frozenAt || customer.signupMethod === "demo") return { credited: 0 };
  const row = await foundingRow(tx, customer.email);
  if (!row || (row.customerId && row.customerId !== customerId)) return { credited: 0 };
  if (!row.customerId) {
    const claimed = await tx.siteWaitlist.updateMany({ where: { id: row.id, customerId: null }, data: { customerId, claimedAt: now } });
    if (!claimed.count) return { credited: 0 };
  }
  if (!customer.tags.includes(FOUNDING_TAG))
    await tx.siteCustomer.update({ where: { id: customerId }, data: { tags: { push: FOUNDING_TAG } } });

  const topup = opts.topupId
    ? await tx.siteTopup.findUnique({ where: { id: opts.topupId } })
    : await tx.siteTopup.findFirst({ where: { customerId, status: "CREDITED" }, orderBy: { createdAt: "asc" } });
  if (!topup || topup.customerId !== customerId || topup.status !== "CREDITED") return { credited: 0 };

  let credited = 0;
  if (!row.emailBonusAt) {
    const amount = FOUNDING.email - (await welcomePaid(tx, customerId, "email"));
    if (amount > 0) {
      const { replay } = await applyLedger(tx, {
        customerId, delta: amount, kind: "BONUS", idempotencyKey: `founding:email:${row.id}`, ref: topup.id,
        note: "Founding Collector Bonus: Email",
      });
      if (!replay) credited += amount;
    }
    await tx.siteWaitlist.update({ where: { id: row.id }, data: { emailBonusAt: now } });
  }
  const m = await tx.siteMarketing.findUnique({ where: { customerId } });
  const smsConfirmed = !!m?.smsPhone && !!m.smsConfirmedAt;
  if (!row.smsBonusAt && smsConfirmed) {
    // One founding text bonus per phone number, whichever account confirms it first.
    const usedElsewhere = await tx.siteLedger.findUnique({ where: { idempotencyKey: `founding:sms-phone:${m!.smsPhone}` } });
    if (!usedElsewhere || usedElsewhere.customerId === customerId) {
      const amount = FOUNDING.sms - (await welcomePaid(tx, customerId, "sms"));
      if (amount > 0) {
        const { replay } = await applyLedger(tx, {
          customerId, delta: amount, kind: "BONUS", idempotencyKey: `founding:sms-phone:${m!.smsPhone}`, ref: topup.id,
          note: "Founding Collector Bonus: Text Alerts",
        });
        if (!replay) credited += amount;
      }
    }
    await tx.siteWaitlist.update({ where: { id: row.id }, data: { smsBonusAt: now } });
  }
  return { credited };
}

/** A refunded or charged-back top-up takes back the founding bonus it unlocked (up to the balance). */
export async function clawFounding(tx: Tx, t: Pick<SiteTopup, "id" | "customerId">, kind: "REFUND" | "CHARGEBACK") {
  const paid = await tx.siteLedger.findMany({ where: { customerId: t.customerId, ref: t.id, kind: "BONUS", idempotencyKey: { startsWith: "founding:" } } });
  let taken = 0;
  for (const p of paid) {
    const key = `founding-claw:${p.id}`;
    if (await tx.siteLedger.findUnique({ where: { idempotencyKey: key } })) continue;
    const take = Math.min(p.delta, await balanceOf(tx, t.customerId));
    if (take <= 0) continue;
    await applyLedger(tx, { customerId: t.customerId, delta: -take, kind, idempotencyKey: key, ref: t.id, note: "Founding Collector Bonus Removed (Payment Reversed)" });
    taken += take;
  }
  return taken;
}

/** Signups for staff (Card Broker / internal checks). */
export async function waitlistStats(db: PrismaClient) {
  const [total, withPhone, claimed] = await Promise.all([
    db.siteWaitlist.count(),
    db.siteWaitlist.count({ where: { phone: { not: null } } }),
    db.siteWaitlist.count({ where: { customerId: { not: null } } }),
  ]);
  return { total, withPhone, claimed };
}
