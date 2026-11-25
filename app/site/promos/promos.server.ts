// Welcome Rewards and the Daily Giveaway for the standalone site.
//
// Welcome Rewards (Trevor, Nov 24): 200 Cardbits for email news, 300 for text alerts, one reward per
// channel per account, kept if the person unsubscribes. Email is credited at signup (the account email
// is already verified by sign-in). Text alerts are credited only after the number confirms (Trevor,
// Nov 25 decision card); until a texting provider confirms it, the request stays "pending".
//
// Daily Giveaway: the same entry engine as Shopify (app/giveaway/entries.server.ts) under the site's
// own shop key, so the site runs its own daily drawing. Entering keeps the Shopify requirements:
// signed in, subscribed to Cardbit email, and one Whatnot visit. Entries stay closed until staff
// enable the site's CardbitGiveawayConfig row.
import type { Prisma, PrismaClient, SiteCustomer } from "@prisma/client";
import { applyLedger } from "../core/ledger.server";
import { settleFounding } from "../waitlist/waitlist.server";
import { activeRound, lockDesk, post, sha } from "../../giveaway/entries.server";
import { drawWinners, snapshotHash } from "../../giveaway/draw";
import { drawWindow, giveawayTotals, paidEntries, PRIZE, rulesLink, STATES } from "../../giveaway/rules";

export const SITE_GIVEAWAY_SHOP = "cardbit-site";
export const WELCOME = { email: 200, sms: 300 } as const;
export const WELCOME_TERMS = "welcome-2026-11-25";
export type Channel = keyof typeof WELCOME;
type Tx = Prisma.TransactionClient;

export const welcomeOn = (env: NodeJS.ProcessEnv = process.env) => env.CARDBIT_SITE_WELCOME === "on";

export class PromoError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

/** US mobile numbers only, stored as E.164. */
export function usPhone(input: unknown): string | null {
  const digits = String(input ?? "").replace(/[^\d]/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null;
  return "+1" + ten;
}

const emailOn = (m: { emailOptInAt: Date | null; emailOptOutAt: Date | null } | null) =>
  !!m?.emailOptInAt && (!m.emailOptOutAt || m.emailOptOutAt < m.emailOptInAt);

export async function subscribedToEmail(db: PrismaClient | Tx, customerId: string) {
  return emailOn(await db.siteMarketing.findUnique({ where: { customerId } }));
}

export async function welcomeView(db: PrismaClient, customer: SiteCustomer | null) {
  if (!welcomeOn()) return { enabled: false };
  if (!customer) return { enabled: true, signedIn: false, amounts: WELCOME };
  const [m, awards] = await Promise.all([
    db.siteMarketing.findUnique({ where: { customerId: customer.id } }),
    db.siteLedger.findMany({
      where: { customerId: customer.id, idempotencyKey: { in: ["welcome:email:" + customer.id, "welcome:sms:" + customer.id] } },
      select: { idempotencyKey: true, createdAt: true },
    }),
  ]);
  const awarded = (c: Channel) => awards.find((a) => a.idempotencyKey === `welcome:${c}:${customer.id}`)?.createdAt.toISOString() ?? null;
  const smsOn = !!m?.smsConfirmedAt && (!m.smsOptOutAt || m.smsOptOutAt < m.smsConfirmedAt);
  const smsPending = !!m?.smsRequestedAt && !smsOn && (!m.smsOptOutAt || m.smsOptOutAt < m.smsRequestedAt);
  return {
    enabled: true,
    signedIn: true,
    amounts: WELCOME,
    email: {
      status: emailOn(m) ? "subscribed" : m?.emailOptOutAt ? "unsubscribed" : null,
      address: customer.email,
      awardedAt: awarded("email"),
    },
    sms: {
      status: smsOn ? "subscribed" : smsPending ? "pending" : m?.smsOptOutAt ? "unsubscribed" : null,
      last4: m?.smsPhone ? m.smsPhone.slice(-4) : null,
      awardedAt: awarded("sms"),
    },
  };
}

type Ctx = { ip?: string | null; now?: Date; source?: string };

/** Opt in to email news. Credits 200 Cardbits the first time only. */
export async function joinEmail(db: PrismaClient, customer: SiteCustomer, consent: unknown, ctx: Ctx = {}) {
  if (consent !== true) throw new PromoError("Check the Box to Agree to Cardbit Emails.", 400);
  const now = ctx.now ?? new Date();
  return db.$transaction(async (tx) => {
    await tx.siteMarketing.upsert({
      where: { customerId: customer.id },
      create: { customerId: customer.id, emailOptInAt: now, emailSource: ctx.source ?? "welcome-rewards", termsVersion: WELCOME_TERMS, ip: ctx.ip ?? null },
      update: { emailOptInAt: now, emailSource: ctx.source ?? "welcome-rewards", termsVersion: WELCOME_TERMS, ip: ctx.ip ?? null, syncedAt: null },
    });
    const { replay } = await applyLedger(tx, {
      customerId: customer.id, delta: WELCOME.email, kind: "BONUS",
      idempotencyKey: "welcome:email:" + customer.id, ref: "welcome", note: "Welcome Rewards: Email Signup",
    });
    return { credited: replay ? 0 : WELCOME.email };
  });
}

/** Request text alerts. Nothing is credited until the number confirms (confirmSms). */
export async function requestSms(db: PrismaClient, customer: SiteCustomer, phone: unknown, consent: unknown, ctx: Ctx = {}) {
  if (consent !== true) throw new PromoError("Check the Box to Agree to Cardbit Text Alerts.", 400);
  const number = usPhone(phone);
  if (!number) throw new PromoError("Enter a 10-Digit US Mobile Number.", 400);
  const now = ctx.now ?? new Date();
  const owner = await db.siteMarketing.findUnique({ where: { smsPhone: number } });
  if (owner && owner.customerId !== customer.id) throw new PromoError("That Number Is Already Linked to Another Cardbit Account.");
  const mine = await db.siteMarketing.findUnique({ where: { customerId: customer.id } });
  // A number that earned the reward stays on the account, so it can't be moved to earn again.
  if (mine?.smsPhone && mine.smsPhone !== number && mine.smsConfirmedAt)
    throw new PromoError("Your Account Already Has a Confirmed Number. Contact Support@cardbit.com to Change It.");
  try {
    await db.siteMarketing.upsert({
      where: { customerId: customer.id },
      create: { customerId: customer.id, smsPhone: number, smsRequestedAt: now, smsSource: ctx.source ?? "welcome-rewards", termsVersion: WELCOME_TERMS, ip: ctx.ip ?? null },
      update: { smsPhone: number, smsRequestedAt: now, smsSource: ctx.source ?? "welcome-rewards", termsVersion: WELCOME_TERMS, ip: ctx.ip ?? null, syncedAt: null },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new PromoError("That Number Is Already Linked to Another Cardbit Account.");
    throw e;
  }
  return { pending: true };
}

/** Called once the texting provider reports the number confirmed. Credits 300 the first time only. */
export async function confirmSms(db: PrismaClient, customerId: string, phone: string, now = new Date()) {
  return db.$transaction(async (tx) => {
    const m = await tx.siteMarketing.findUnique({ where: { customerId } });
    if (!m?.smsPhone || m.smsPhone !== phone || !m.smsRequestedAt) return { credited: 0 };
    await tx.siteMarketing.update({ where: { customerId }, data: { smsConfirmedAt: now, syncedAt: null } });
    const { replay } = await applyLedger(tx, {
      customerId, delta: WELCOME.sms, kind: "BONUS",
      idempotencyKey: "welcome:sms:" + customerId, ref: "welcome", note: "Welcome Rewards: Text Signup",
    });
    // Founding Collectors who already topped up get the rest of their text bonus (600 total) now.
    const founding = await settleFounding(tx, customerId, { now });
    return { credited: (replay ? 0 : WELCOME.sms) + founding.credited };
  });
}

/** Unsubscribe. source: "account" (the customer), "staff" (Card Broker, on the customer's request) or "klaviyo". */
export async function leave(db: PrismaClient, customer: Pick<SiteCustomer, "id">, channel: unknown, now = new Date(), source = "account") {
  if (channel !== "email" && channel !== "sms") throw new PromoError("Choose Email or Texts.", 400);
  const data = channel === "email" ? { emailOptOutAt: now, emailSource: source, syncedAt: null } : { smsOptOutAt: now, smsSource: source, syncedAt: null };
  await db.siteMarketing.upsert({ where: { customerId: customer.id }, create: { customerId: customer.id, ...data }, update: data });
}

// ---------- Daily Giveaway ----------

/** Same shape as the Shopify proxy view, plus the site's email consent and frozen-account hold. */
export async function giveawayHeld(db: PrismaClient | Tx, customer: SiteCustomer) {
  return Boolean(customer.frozenAt || customer.closedAt);
}

/**
 * Close every elapsed site round: snapshot eligible entrants (email-subscribed, Whatnot visited,
 * not held, account not frozen), draw with the committed seed, and credit the winner's site wallet
 * in the same transaction. Runs lazily from the giveaway API; does nothing while entries are off.
 */
export async function settleDueSiteRounds(db: PrismaClient, clock = () => new Date()) {
  const shop = SITE_GIVEAWAY_SHOP;
  const cfg = await db.cardbitGiveawayConfig.findUnique({ where: { shop } });
  if (!cfg?.enabled) return 0;
  const due = await db.cardbitGiveawayRound.findMany({
    where: { shop, closedAt: null, closesAt: { lte: clock() } },
    orderBy: { closesAt: "asc" },
    take: 5,
  });
  let closed = 0;
  for (const round of due) {
    const done = await db.$transaction(
      async (tx) => {
        await lockDesk(tx, shop);
        const row = await tx.cardbitGiveawayRound.findUniqueOrThrow({ where: { shop_day: { shop, day: round.day } } });
        if (row.closedAt || row.closesAt > clock()) return false;
        const events = await tx.cardbitGiveawayEvent.findMany({ where: { shop, day: round.day } });
        const ids = [...new Set(events.filter((e) => e.kind === "daily" && !e.voided).map((e) => e.customerId))];
        const [people, marketing, customers] = await Promise.all([
          tx.cardbitGiveawayPerson.findMany({ where: { shop, customerId: { in: ids }, held: false, whatnotAt: { not: null } } }),
          tx.siteMarketing.findMany({ where: { customerId: { in: ids } } }),
          tx.siteCustomer.findMany({ where: { id: { in: ids } }, select: { id: true, frozenAt: true, closedAt: true } }),
        ]);
        const subscribed = new Set(marketing.filter(emailOn).map((m) => m.customerId));
        const active = new Set(customers.filter((c) => !c.frozenAt && !c.closedAt).map((c) => c.id));
        const eligible = people.filter((p) => subscribed.has(p.customerId) && active.has(p.customerId));
        const byId = new Map(eligible.map((p) => [p.customerId, p.code]));
        const tickets = giveawayTotals(events, new Set(byId.keys()))
          .map((t) => ({ entrantId: byId.get(t.entrantId)!, entries: t.entries }))
          .sort((a, b) => a.entrantId.localeCompare(b.entrantId));
        const total = tickets.reduce((n, x) => n + x.entries, 0);
        if (!Number.isSafeInteger(total) || total > 2147483647) throw Error("Entry count requires review.");
        const code = drawWinners(tickets, 1, row.seed)[0];
        const winnerId = eligible.find((p) => p.code === code)?.customerId ?? null;
        if (winnerId)
          await applyLedger(tx, {
            customerId: winnerId, delta: PRIZE, kind: "REWARD",
            idempotencyKey: "giveaway:" + round.day, ref: "giveaway:" + round.day,
            note: "Daily Giveaway Prize " + round.day + " (" + sha(round.day + "|" + code).slice(0, 12) + ")",
          });
        await tx.cardbitGiveawayRound.update({
          where: { shop_day: { shop, day: round.day } },
          data: {
            closedAt: clock(), winnerId, totalEntries: total, participantCount: tickets.length,
            snapshot: tickets, snapshotHash: snapshotHash(tickets),
          },
        });
        return true;
      },
      { timeout: 30000 },
    );
    if (done) closed++;
  }
  return closed;
}

/** Official Rules: 1 entry per 100 paid Cardbits (base top-up only, never the bonus). Inside the credit transaction. */
export async function siteFundEntries(tx: Tx, customerId: string, topupId: string, paidBits: number) {
  const entries = paidEntries(paidBits);
  if (!entries) return;
  const shop = SITE_GIVEAWAY_SHOP;
  await lockDesk(tx, shop);
  if (!(await tx.cardbitGiveawayConfig.findUnique({ where: { shop } }))?.enabled) return;
  const { day } = await activeRound(tx, new Date(), shop);
  await post(tx, { day, customerId, key: "fund:" + topupId, kind: "purchase", entries }, shop);
}

/** A refund or chargeback voids that top-up's entries (a closed drawing's snapshot stays as drawn). */
export async function voidSiteFundEntries(tx: Tx, topupId: string) {
  const shop = SITE_GIVEAWAY_SHOP;
  await lockDesk(tx, shop);
  const event = await tx.cardbitGiveawayEvent.findUnique({ where: { shop_key: { shop, key: "fund:" + topupId } } });
  if (!event || event.voided) return;
  await tx.cardbitGiveawayEvent.update({ where: { id: event.id }, data: { voided: true } });
  const round = await tx.cardbitGiveawayRound.findUnique({ where: { shop_day: { shop, day: event.day } } });
  if (round?.closedAt)
    await tx.cardbitGiveawayAudit.create({ data: { shop, actor: "payment-review", action: "closed-draw-funding-review", detail: event.day + " " + event.key } });
}

/** Staff settings for the site's drawing (Card Broker desk, server-to-server). */
export async function setSiteGiveaway(db: PrismaClient, actor: string, input: { enabled?: unknown; rulesUrl?: unknown; freeInstructions?: unknown }) {
  const shop = SITE_GIVEAWAY_SHOP;
  let rulesUrl: string;
  try { rulesUrl = rulesLink(input.rulesUrl); } catch { throw new PromoError("Enter a Cardbit official rules page.", 400); }
  const freeInstructions = String(input.freeInstructions ?? "").trim().slice(0, 4000);
  const enabled = input.enabled === true;
  if (enabled && (!rulesUrl || !freeInstructions))
    throw new PromoError("Add the official rules and free bonus-entry instructions before opening entries.", 400);
  await db.$transaction(async (tx) => {
    await lockDesk(tx, shop);
    const data = { enabled, rulesUrl, freeInstructions };
    await tx.cardbitGiveawayConfig.upsert({ where: { shop }, create: { shop, ...data }, update: data });
    if (enabled) await activeRound(tx, new Date(), shop);
    await tx.cardbitGiveawayAudit.create({ data: { shop, actor, action: "settings", detail: JSON.stringify(data) } });
  });
}

export { drawWindow, STATES };
