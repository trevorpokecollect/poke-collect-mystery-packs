// Staff tools Card Broker calls on the standalone site (Shopify-gap audit, Trevor Nov 25 2026):
// adjust a customer's Cardbits, reverse a pack opening or a single purchase, order page with staff
// notes and a timeline, close/reopen an account, and privacy export/erase.
//
// Rules:
// - Card Broker authenticates its own staff and enforces roles; the site records who acted (actor).
// - Every action is keyed by Card Broker's requestId, so a retried click never acts twice.
// - Money moves only through the ledger (never below zero). Reversals return the exact Cardbits paid
//   and put the cards back in stock as Draft; they refuse when any card has already left the vault
//   (sold back, shipping, shipped), so staff use Adjust Balance for those cases instead.
// - Erase keeps transaction records (ledger, top-ups, shipments) as the Privacy Policy says, and
//   removes the personal data that is not needed for them.
import type { Prisma, PrismaClient, SiteCustomer } from "@prisma/client";
import { applyLedger, balanceOf, InsufficientCardbits } from "./ledger.server";
import { reverseOpeningRewards } from "../rewards/rewards.server";
import { ORDER_TYPES, type OrderType } from "./orders-desk.server";

type Tx = Prisma.TransactionClient;

export class AdminError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

export const ADJUST_LIMIT = 1_000_000; // 10,000 dollars of Cardbits in one adjustment

const reasonOf = (raw: unknown) => {
  const r = String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
  if (r.length < 3) throw new AdminError("Add a reason (at least 3 characters).");
  return r;
};
const requestOf = (raw: unknown) => {
  const r = String(raw ?? "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(r)) throw new AdminError("Missing request id.");
  return r;
};

/** Already done? Returns the earlier result for a retried request. */
async function priorAction(db: PrismaClient | Tx, requestId: string) {
  const a = await db.siteStaffAction.findUnique({ where: { requestId } });
  return a ? { replay: true as const, action: a } : null;
}

async function customerOrThrow(db: PrismaClient | Tx, id: string) {
  const c = await db.siteCustomer.findUnique({ where: { id: String(id || "").slice(0, 64) } });
  if (!c) throw new AdminError("No such customer.", 404);
  return c;
}

// ---------- Adjust Balance ----------

export async function adjustBalance(
  db: PrismaClient,
  actor: string,
  input: { customerId: unknown; delta: unknown; reason: unknown; requestId: unknown; visibleNote?: unknown },
) {
  const requestId = requestOf(input.requestId);
  const reason = reasonOf(input.reason);
  const delta = Number(input.delta);
  if (!Number.isSafeInteger(delta) || delta === 0) throw new AdminError("Enter a whole number of Cardbits (not zero).");
  if (Math.abs(delta) > ADJUST_LIMIT) throw new AdminError(`Adjustments are limited to ${ADJUST_LIMIT.toLocaleString("en-US")} Cardbits at a time.`);
  const prior = await priorAction(db, requestId);
  if (prior) return { replay: true, balance: await balanceOf(db, prior.action.customerId!) };
  const customer = await customerOrThrow(db, String(input.customerId));
  // The customer sees this line in their Cardbits history; staff can word it, otherwise a neutral default.
  const note = String(input.visibleNote ?? "").trim().slice(0, 120) || (delta > 0 ? "Cardbits added by Cardbit support" : "Cardbits removed by Cardbit support");
  try {
    return await db.$transaction(async (tx) => {
      const { entry } = await applyLedger(tx, { customerId: customer.id, delta, kind: "ADJUST", idempotencyKey: `staff-adjust:${requestId}`, ref: `staff:${requestId}`, note });
      await tx.siteStaffAction.create({ data: { action: "adjust", actor, customerId: customer.id, reason, requestId, detail: { delta, note, ledgerId: entry.id } } });
      return { replay: false, balance: entry.balanceAfter, ledgerId: entry.id };
    });
  } catch (e) {
    if (e instanceof InsufficientCardbits) throw new AdminError(`The balance is only ${e.balance.toLocaleString("en-US")} Cardbits, so that much can't be removed.`);
    throw e;
  }
}

// ---------- Reversals ----------

/** Cards that left the vault can't come back automatically. */
const outOfVault = (status: string) => status !== "VAULTED";

export async function reversePack(db: PrismaClient, actor: string, input: { openingId: unknown; reason: unknown; requestId: unknown }) {
  const requestId = requestOf(input.requestId);
  const reason = reasonOf(input.reason);
  const prior = await priorAction(db, requestId);
  if (prior) return { replay: true, refundedBits: (prior.action.detail as { refundedBits?: number } | null)?.refundedBits ?? 0 };
  const openingId = String(input.openingId ?? "").slice(0, 64);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SiteOpening" WHERE id = ${openingId} FOR UPDATE`;
      const o = await tx.siteOpening.findUnique({ where: { id: openingId } });
      if (!o) throw new AdminError("No such pack opening.", 404);
      if (o.demo) throw new AdminError("Demo openings are free; use Wipe Demo instead.");
      if (o.reversedAt) throw new AdminError("This pack was already reversed.");
      const debit = await tx.siteLedger.findFirst({ where: { kind: "PACK", ref: o.id, customerId: o.customerId } });
      if (!debit) throw new AdminError("No Cardbits payment found for this opening.");
      const cards = await tx.siteCopy.findMany({ where: { openingId: o.id } });
      const gone = cards.filter((c) => c.ownerId !== o.customerId || outOfVault(c.status));
      if (gone.length)
        throw new AdminError(
          `${gone.length} of ${cards.length} card${cards.length === 1 ? "" : "s"} already left the vault (sold back or shipping). Use Adjust Balance instead.`,
        );
      const refundedBits = -debit.delta;
      await applyLedger(tx, { customerId: o.customerId, delta: refundedBits, kind: "REFUND", idempotencyKey: `staff-reverse-pack:${o.id}`, ref: o.id, note: "Pack reversed by Cardbit support: Cardbits returned" });
      for (const c of cards) {
        const n = await tx.siteCopy.updateMany({
          where: { id: c.id, status: "VAULTED", ownerId: o.customerId },
          data: { status: "DRAFT", ownerId: null, orderId: null, autoRestock: true },
        });
        if (n.count !== 1) throw new AdminError("A card changed while reversing. Try again.", 409);
        await tx.siteCopyEvent.create({ data: { copyId: c.id, fromStatus: "VAULTED", toStatus: "DRAFT", actor, reason: `pack ${o.id} reversed: ${reason}`.slice(0, 300) } });
      }
      await tx.siteOpening.update({ where: { id: o.id }, data: { reversedAt: new Date(), reversedBy: actor, reverseReason: reason, sealed: false } });
      await reverseOpeningRewards(tx, [o.id], `reversed by staff: ${reason}`.slice(0, 190));
      await tx.siteStaffAction.create({
        data: { action: "reverse_pack", actor, customerId: o.customerId, orderType: "PACK", orderRef: o.id, reason, requestId, detail: { refundedBits, copyIds: cards.map((c) => c.id) } },
      });
      return { replay: false, refundedBits, customerId: o.customerId, cards: cards.length, balance: await balanceOf(tx, o.customerId) };
    },
    { timeout: 15_000 },
  );
}

/** `ledgerId` is the SINGLE purchase row (the Orders feed id for singles). */
export async function reverseSingle(db: PrismaClient, actor: string, input: { ledgerId: unknown; reason: unknown; requestId: unknown }) {
  const requestId = requestOf(input.requestId);
  const reason = reasonOf(input.reason);
  const prior = await priorAction(db, requestId);
  if (prior) return { replay: true, refundedBits: (prior.action.detail as { refundedBits?: number } | null)?.refundedBits ?? 0 };
  const ledgerId = String(input.ledgerId ?? "").slice(0, 64);
  return db.$transaction(
    async (tx) => {
      const buy = await tx.siteLedger.findUnique({ where: { id: ledgerId } });
      if (!buy || buy.kind !== "SINGLE" || !buy.ref) throw new AdminError("No such single purchase.", 404);
      if (await tx.siteLedger.findUnique({ where: { idempotencyKey: `staff-reverse-single:${buy.id}` } })) throw new AdminError("This purchase was already reversed.");
      await tx.$queryRaw`SELECT id FROM "SiteCopy" WHERE id = ${buy.ref} FOR UPDATE`;
      const c = await tx.siteCopy.findUnique({ where: { id: buy.ref } });
      if (!c) throw new AdminError("The card for this purchase no longer exists.");
      // Same customer still holds it, and no later purchase of the same copy by someone else.
      const later = await tx.siteLedger.findFirst({ where: { ref: c.id, createdAt: { gt: buy.createdAt }, kind: { in: ["SINGLE", "BUYBACK"] } } });
      if (c.ownerId !== buy.customerId || outOfVault(c.status) || later)
        throw new AdminError("This card already left the customer's vault (sold back or shipping). Use Adjust Balance instead.");
      const refundedBits = -buy.delta;
      await applyLedger(tx, { customerId: buy.customerId, delta: refundedBits, kind: "REFUND", idempotencyKey: `staff-reverse-single:${buy.id}`, ref: c.id, note: `Purchase reversed by Cardbit support: ${c.title}`.slice(0, 190) });
      // Back to Draft (hidden) so staff can check it before making it Active again.
      await tx.siteCopy.update({ where: { id: c.id }, data: { status: "DRAFT", ownerId: null, orderId: null } });
      await tx.siteCopyEvent.create({ data: { copyId: c.id, fromStatus: "VAULTED", toStatus: "DRAFT", actor, reason: `single ${buy.id} reversed: ${reason}`.slice(0, 300) } });
      await tx.siteStaffAction.create({
        data: { action: "reverse_single", actor, customerId: buy.customerId, orderType: "SINGLE", orderRef: buy.id, reason, requestId, detail: { refundedBits, copyId: c.id } },
      });
      return { replay: false, refundedBits, customerId: buy.customerId, balance: await balanceOf(tx, buy.customerId) };
    },
    { timeout: 15_000 },
  );
}

// ---------- Order page: detail, notes, timeline ----------

export type TimelineEvent = { at: string; kind: string; text: string; actor: string | null };

const isType = (t: unknown): t is OrderType => (ORDER_TYPES as readonly string[]).includes(String(t));
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const who = (actor: string | null | undefined) =>
  !actor ? null : actor.startsWith("customer:") ? "Customer" : actor.startsWith("cardbroker:") ? actor.slice("cardbroker:".length) : actor;

export async function orderDetail(db: PrismaClient, type: unknown, ref: unknown) {
  if (!isType(type)) throw new AdminError("Unknown order type.");
  const id = String(ref ?? "").slice(0, 190);
  const events: TimelineEvent[] = [];
  const push = (at: Date, kind: string, text: string, actor: string | null = null) => events.push({ at: at.toISOString(), kind, text, actor: who(actor) });
  let customerId: string;
  let summary: Record<string, unknown>;
  let copyIds: string[] = [];
  let ledgerWhere: Prisma.SiteLedgerWhereInput;
  const actions: { canReversePack?: boolean; canReverseSingle?: boolean; reverseBlockedReason?: string | null } = {};

  if (type === "PACK") {
    const o = await db.siteOpening.findUnique({ where: { id } });
    if (!o) throw new AdminError("No such order.", 404);
    const pack = await db.sitePack.findUnique({ where: { id: o.packId }, select: { title: true } });
    customerId = o.customerId;
    const cards = await db.siteCopy.findMany({ where: { openingId: o.id }, orderBy: { position: "asc" } });
    copyIds = cards.map((c) => c.id);
    ledgerWhere = { ref: o.id };
    summary = {
      title: pack?.title ?? o.packId, priceBits: o.priceBits, demo: o.demo, sealed: o.sealed, revealedAt: iso(o.revealedAt),
      reversedAt: iso(o.reversedAt), reversedBy: who(o.reversedBy), reverseReason: o.reverseReason,
      status: o.reversedAt ? "Reversed" : o.sealed && !o.revealedAt ? "Sealed" : o.revealedAt ? "Opened" : "Opening",
    };
    push(o.createdAt, "order", `Bought ${pack?.title ?? "pack"} for ${o.priceBits.toLocaleString("en-US")} Cardbits${o.demo ? " (demo)" : ""}`, `customer:${o.customerId}`);
    if (o.revealedAt) push(o.revealedAt, "reveal", "Pack revealed", `customer:${o.customerId}`);
    const blocked = o.demo ? "Demo opening" : o.reversedAt ? "Already reversed" : cards.some((c) => c.ownerId !== o.customerId || outOfVault(c.status)) ? "A card already left the vault" : null;
    actions.canReversePack = !blocked;
    actions.reverseBlockedReason = blocked;
  } else if (type === "SINGLE" || type === "BUYBACK") {
    const l = await db.siteLedger.findUnique({ where: { id } });
    if (!l || l.kind !== type) throw new AdminError("No such order.", 404);
    customerId = l.customerId;
    copyIds = l.ref ? [l.ref] : [];
    ledgerWhere = { OR: [{ id: l.id }, ...(l.ref ? [{ ref: l.ref, customerId: l.customerId, createdAt: { gte: l.createdAt } }] : [])] };
    summary = { title: l.note ?? l.kind, bits: l.delta, status: "Done" };
    if (type === "SINGLE") {
      const c = l.ref ? await db.siteCopy.findUnique({ where: { id: l.ref } }) : null;
      const reversed = await db.siteLedger.findUnique({ where: { idempotencyKey: `staff-reverse-single:${l.id}` } });
      if (reversed) summary.status = "Reversed";
      const blocked = reversed ? "Already reversed" : !c || c.ownerId !== l.customerId || outOfVault(c.status) ? "The card already left the vault" : null;
      actions.canReverseSingle = !blocked;
      actions.reverseBlockedReason = blocked;
    }
  } else if (type === "SHIPPING") {
    const s = await db.siteShipment.findUnique({ where: { id }, include: { items: true, events: { orderBy: { createdAt: "asc" } } } });
    if (!s) throw new AdminError("No such order.", 404);
    customerId = s.customerId;
    copyIds = s.items.map((i) => i.copyId);
    ledgerWhere = { OR: [{ ref: s.id }, { idempotencyKey: { contains: s.id } }] };
    summary = {
      title: `Ship ${s.cardCount} card${s.cardCount === 1 ? "" : "s"}`, status: s.status, feeKind: s.feeKind, feeBits: s.feeBits, feeCents: s.feeCents,
      carrier: s.carrier, service: s.service, trackingNumber: s.trackingNumber, trackingUrl: s.trackingUrl, toName: s.toName, toAddress: s.toAddress,
      processBy: iso(s.processBy), shippedAt: iso(s.shippedAt), deliveredAt: iso(s.deliveredAt),
    };
    push(s.createdAt, "order", `Shipping requested for ${s.cardCount} card${s.cardCount === 1 ? "" : "s"}`, `customer:${s.customerId}`);
    for (const e of s.events) push(e.createdAt, "shipment", `${e.kind.replace(/_/g, " ")}${e.toStatus ? `: ${e.toStatus.replace(/_/g, " ").toLowerCase()}` : ""}`, e.actor);
  } else {
    const t = await db.siteTopup.findUnique({ where: { id } });
    if (!t) throw new AdminError("No such order.", 404);
    customerId = t.customerId;
    ledgerWhere = { ref: t.id };
    summary = {
      title: `${(t.baseBits + t.bonusBits).toLocaleString("en-US")} Cardbits`, status: t.status, cents: t.cents, baseBits: t.baseBits, bonusBits: t.bonusBits,
      provider: t.provider, paymentId: t.paymentId, billingState: t.billingState, riskLevel: t.riskLevel, clawedBits: t.clawedBits, owedBits: t.owedBits,
      // Card refunds happen in the processor's dashboard; its webhook takes the Cardbits back here.
      refundHint: t.provider === "stripe" ? "Refund in the Stripe dashboard; the site takes the Cardbits back automatically." : "Refund in the Coinflow dashboard; the site takes the Cardbits back automatically.",
    };
    push(t.createdAt, "order", `Checkout started: $${(t.cents / 100).toFixed(2)} for ${(t.baseBits + t.bonusBits).toLocaleString("en-US")} Cardbits (${t.provider})`, `customer:${t.customerId}`);
    if (t.paymentId) {
      const hooks = await db.siteWebhookEvent.findMany({ where: { ref: t.paymentId }, orderBy: { receivedAt: "asc" }, take: 50 });
      for (const h of hooks) push(h.receivedAt, "payment", `${t.provider} ${h.eventType}${h.result ? ` → ${h.result}` : ""}`, t.provider);
    }
  }

  const [customer, ledger, copyEvents, notes, staff, copies] = await Promise.all([
    db.siteCustomer.findUnique({ where: { id: customerId }, select: { id: true, email: true, name: true, frozenAt: true, closedAt: true } }),
    db.siteLedger.findMany({ where: { customerId, ...ledgerWhere }, orderBy: { createdAt: "asc" }, take: 100 }),
    copyIds.length ? db.siteCopyEvent.findMany({ where: { copyId: { in: copyIds } }, orderBy: { createdAt: "asc" }, take: 300 }) : [],
    db.siteOrderNote.findMany({ where: { orderType: type, orderRef: id }, orderBy: { createdAt: "asc" } }),
    db.siteStaffAction.findMany({ where: { orderType: type, orderRef: id }, orderBy: { createdAt: "asc" } }),
    copyIds.length ? db.siteCopy.findMany({ where: { id: { in: copyIds } } }) : [],
  ]);
  for (const l of ledger) push(l.createdAt, "cardbits", `${l.delta > 0 ? "+" : ""}${l.delta.toLocaleString("en-US")} Cardbits · ${l.kind}${l.note ? ` · ${l.note}` : ""}`, null);
  const titles = new Map(copies.map((c) => [c.id, c.title]));
  for (const e of copyEvents) push(e.createdAt, "card", `${titles.get(e.copyId) ?? "Card"}: ${(e.fromStatus ?? "new").toLowerCase()} → ${e.toStatus.toLowerCase()} (${e.reason})`, e.actor);
  for (const n of notes) push(n.createdAt, "note", n.body, n.actor);
  for (const a of staff) push(a.createdAt, "staff", `${a.action.replace(/_/g, " ")}${a.reason ? `: ${a.reason}` : ""}`, a.actor);
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const order = new Map(copyIds.map((cid, i) => [cid, i]));
  return {
    type,
    id,
    customer: customer && { ...customer, frozenAt: iso(customer.frozenAt), closedAt: iso(customer.closedAt) },
    summary,
    items: copies
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map((c) => ({
        id: c.id, title: c.title, image: c.image, condition: c.condition, language: c.language, status: c.status, kind: c.kind, slot: c.slot, pocket: c.pocket,
        tier: c.pulledTier, grader: c.grader, grade: c.grade, certNumber: c.certNumber,
      })),
    notes: notes.map((n) => ({ id: n.id, body: n.body, actor: who(n.actor), at: n.createdAt.toISOString() })),
    timeline: events,
    actions,
  };
}

export async function addOrderNote(db: PrismaClient, actor: string, input: { type: unknown; ref: unknown; body: unknown }) {
  if (!isType(input.type)) throw new AdminError("Unknown order type.");
  const body = String(input.body ?? "").trim().slice(0, 2000);
  if (!body) throw new AdminError("Write a note first.");
  const ref = String(input.ref ?? "").slice(0, 190);
  const detail = await orderDetail(db, input.type, ref); // also proves the order exists
  if (!detail.customer) throw new AdminError("No customer for this order.");
  const n = await db.siteOrderNote.create({ data: { orderType: input.type, orderRef: ref, customerId: detail.customer.id, body, actor } });
  return { id: n.id };
}

// ---------- Close, reopen, export, erase ----------

export async function closeAccount(db: PrismaClient, actor: string, input: { customerId: unknown; reason: unknown; requestId: unknown }) {
  const requestId = requestOf(input.requestId);
  const reason = reasonOf(input.reason);
  if (await priorAction(db, requestId)) return { replay: true };
  const c = await customerOrThrow(db, String(input.customerId));
  if (c.closedAt) throw new AdminError("This account is already closed.");
  await db.$transaction(async (tx) => {
    await tx.siteCustomer.update({ where: { id: c.id }, data: { closedAt: new Date() } });
    await tx.siteSession.updateMany({ where: { customerId: c.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.siteStaffAction.create({ data: { action: "close", actor, customerId: c.id, reason, requestId, detail: { balance: await balanceOf(tx, c.id) } } });
  });
  return { replay: false };
}

export async function reopenAccount(db: PrismaClient, actor: string, input: { customerId: unknown; reason: unknown; requestId: unknown }) {
  const requestId = requestOf(input.requestId);
  const reason = reasonOf(input.reason);
  if (await priorAction(db, requestId)) return { replay: true };
  const c = await customerOrThrow(db, String(input.customerId));
  if (!c.closedAt) throw new AdminError("This account is open.");
  if (isErased(c)) throw new AdminError("Erased accounts can't be reopened.");
  await db.$transaction(async (tx) => {
    await tx.siteCustomer.update({ where: { id: c.id }, data: { closedAt: null } });
    await tx.siteStaffAction.create({ data: { action: "reopen", actor, customerId: c.id, reason, requestId } });
  });
  return { replay: false };
}

const ERASED_DOMAIN = "erased.cardbit.invalid";
export const isErased = (c: Pick<SiteCustomer, "email">) => c.email.endsWith("@" + ERASED_DOMAIN);

/** Everything the site holds about one person, for an access request (JSON the staff member sends on). */
export async function exportCustomer(db: PrismaClient, actor: string, input: { customerId: unknown; reason: unknown; requestId: unknown }) {
  const requestId = requestOf(input.requestId);
  const reason = reasonOf(input.reason);
  const c = await customerOrThrow(db, String(input.customerId));
  const where = { customerId: c.id };
  const [marketing, ledger, topups, openings, shipments, vault, wants, visits, play, subs, chat] = await Promise.all([
    db.siteMarketing.findUnique({ where }),
    db.siteLedger.findMany({ where, orderBy: { createdAt: "asc" } }),
    db.siteTopup.findMany({ where, orderBy: { createdAt: "asc" }, select: { id: true, createdAt: true, cents: true, baseBits: true, bonusBits: true, status: true, provider: true, billingState: true, billingZip: true, ip: true, ipRegion: true } }),
    db.siteOpening.findMany({ where, orderBy: { createdAt: "asc" } }),
    db.siteShipment.findMany({ where, orderBy: { createdAt: "asc" }, include: { items: { select: { title: true } } } }),
    db.siteCopy.findMany({ where: { ownerId: c.id }, select: { title: true, condition: true, status: true } }),
    db.siteWant.findMany({ where }),
    db.siteVisit.findMany({ where, orderBy: { startedAt: "asc" }, take: 2000, select: { startedAt: true, landingPath: true, source: true, device: true, browser: true, os: true, country: true, region: true } }),
    db.sitePlayControl.findUnique({ where }),
    db.siteSubscription.findMany({ where }),
    db.siteChatMessage.findMany({ where, select: { createdAt: true, room: true, body: true } }),
  ]);
  if (!(await priorAction(db, requestId)))
    await db.siteStaffAction.create({ data: { action: "export", actor, customerId: c.id, reason, requestId } });
  return {
    exportedAt: new Date().toISOString(),
    account: { id: c.id, email: c.email, name: c.name, signupMethod: c.signupMethod, createdAt: c.createdAt, termsVersion: c.termsVersion, termsAcceptedAt: c.termsAcceptedAt, frozenAt: c.frozenAt, closedAt: c.closedAt },
    marketing: marketing && { emailOptInAt: marketing.emailOptInAt, emailOptOutAt: marketing.emailOptOutAt, smsPhone: marketing.smsPhone, smsRequestedAt: marketing.smsRequestedAt, smsConfirmedAt: marketing.smsConfirmedAt, smsOptOutAt: marketing.smsOptOutAt },
    balance: await balanceOf(db, c.id),
    cardbitsHistory: ledger.map((l) => ({ at: l.createdAt, delta: l.delta, kind: l.kind, note: l.note })),
    topups,
    packOpenings: openings.map((o) => ({ at: o.createdAt, packId: o.packId, priceBits: o.priceBits, reversedAt: o.reversedAt })),
    shipments: shipments.map((s) => ({ at: s.createdAt, status: s.status, toName: s.toName, toAddress: s.toAddress, cards: s.items.map((i) => i.title), carrier: s.carrier, trackingNumber: s.trackingNumber })),
    vault,
    wants: wants.map((w) => w.cardKey),
    visits,
    playLimits: play,
    subscriptions: subs.map((s) => ({ tier: s.tier, status: s.status, createdAt: s.createdAt, canceledAt: s.canceledAt })),
    chatMessages: chat,
  };
}

/**
 * Privacy erase. The account must be closed first, and the vault empty (cards shipped or sold back),
 * because vaulted cards belong to the person. Keeps the transaction records (ledger, top-ups,
 * shipments and their addresses, openings) that tax, fraud and sweepstakes rules require.
 */
export async function eraseCustomer(db: PrismaClient, actor: string, input: { customerId: unknown; reason: unknown; requestId: unknown; confirmEmail: unknown }) {
  const requestId = requestOf(input.requestId);
  const reason = reasonOf(input.reason);
  if (await priorAction(db, requestId)) return { replay: true };
  const c = await customerOrThrow(db, String(input.customerId));
  if (isErased(c)) throw new AdminError("This customer was already erased.");
  if (!c.closedAt) throw new AdminError("Close the account before erasing it.");
  if (String(input.confirmEmail ?? "").trim().toLowerCase() !== c.email) throw new AdminError("Type the customer's email exactly to confirm.");
  const vaulted = await db.siteCopy.count({ where: { ownerId: c.id, status: { in: ["VAULTED", "SHIP_LOCKED"] } } });
  if (vaulted) throw new AdminError(`${vaulted} card${vaulted === 1 ? " is" : "s are"} still in this customer's vault or shipping. Ship or settle them first.`);
  const oldEmail = c.email;
  await db.$transaction(async (tx) => {
    const where = { customerId: c.id };
    await tx.siteCustomer.update({
      where: { id: c.id },
      data: { email: `${c.id}@${ERASED_DOMAIN}`, name: null, googleSub: null, tags: [], staffNote: `Personal data erased ${new Date().toISOString().slice(0, 10)}.`, riskNote: null },
    });
    // syncedAt = now: the Klaviyo sync must not send the placeholder address; staff delete the Klaviyo profile by hand.
    await tx.siteMarketing.updateMany({ where, data: { smsPhone: null, ip: null, emailOptOutAt: new Date(), smsOptOutAt: new Date(), syncedAt: new Date() } });
    await tx.siteKlaviyoEvent.updateMany({ where: { customerId: c.id, status: { in: ["PENDING", "FAILED"] } }, data: { status: "SKIPPED", error: "customer erased" } });
    await tx.siteSession.deleteMany({ where });
    await tx.siteEmailCode.deleteMany({ where: { email: oldEmail } });
    await tx.siteAppHandoff.deleteMany({ where });
    await tx.siteWant.deleteMany({ where });
    await tx.siteVisit.updateMany({ where, data: { customerId: null } });
    await tx.siteChatMessage.updateMany({ where, data: { name: "Former Member", body: "[removed]", deletedAt: new Date(), deletedBy: actor } });
    await tx.siteTopup.updateMany({ where, data: { ip: null, userAgent: null, deviceId: null } });
    await tx.siteStaffAction.create({ data: { action: "erase", actor, customerId: c.id, reason, requestId } });
  });
  return { replay: false, klaviyo: "Also delete this person's profile in Klaviyo (Profiles → request deletion)." };
}

/** Staff actions for one customer (customer page activity), newest first. */
export async function customerStaffActions(db: PrismaClient, customerId: unknown) {
  const rows = await db.siteStaffAction.findMany({ where: { customerId: String(customerId ?? "").slice(0, 64) }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((a) => ({ id: a.id, action: a.action, actor: who(a.actor), reason: a.reason, orderType: a.orderType, orderRef: a.orderRef, detail: a.detail, at: a.createdAt.toISOString() }));
}
