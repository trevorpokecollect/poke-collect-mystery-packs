// Vault shipping for the standalone site: quote -> create (lock copies + take fee) -> buy label
// (staff) -> tracking webhooks -> delivered. Shopify is not involved.

import type { PrismaClient, SiteShipment } from "@prisma/client";
import { assertAllowedRegion, US_STATES, type GeoLookup } from "../region.server";
import {
  cardsUntilFree,
  parcelFor,
  processBy,
  shippingFee,
  type FeeMethod,
  type ShippingFee,
} from "./policy";
import type { Address, Rate, ShippingProvider, Tracking } from "./shippo.server";
import { priceKey } from "../core/stock.server";
import { CopyLockError, FeePaymentError, type CopyStore, type FeePayer } from "./types";

export type ShipmentStatus =
  | "DRAFT"
  | "PAID"
  | "LABEL_PENDING"
  | "LABEL_PURCHASED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "RETURNED"
  | "EXCEPTION"
  | "CANCELED";

export type ShipEmailKind = "shipment_created" | "shipment_shipped" | "shipment_delivered";

export type ShipNotifier = (kind: ShipEmailKind, shipment: SiteShipment & { items: { title: string }[] }) => Promise<void>;

export class ShippingError extends Error {
  constructor(
    message: string,
    public code:
      | "ADDRESS_INVALID"
      | "NOT_FOUND"
      | "WRONG_STATE"
      | "NO_RATE"
      | "LABEL_FAILED"
      | "PROVIDER_MISSING"
      | "DUPLICATE_COPY",
    public details: string[] = [],
  ) {
    super(message);
    this.name = "ShippingError";
  }
}

export type ShippingDeps = {
  db: PrismaClient;
  copies: CopyStore;
  fees: FeePayer;
  provider: ShippingProvider | null;
  geo?: GeoLookup | null;
  notify?: ShipNotifier;
  /** Cardbit's return / ship-from address. */
  from: Address;
  /** Preferred Shippo service level tokens, best first. */
  services?: string[];
  now?: () => Date;
};

export const DEFAULT_SERVICES = ["usps_ground_advantage", "usps_priority", "ups_ground_saver", "ups_ground"];

export function fromAddressFromEnv(env: NodeJS.ProcessEnv = process.env): Address {
  return {
    name: env.CARDBIT_SHIP_FROM_NAME || "Cardbit",
    company: env.CARDBIT_SHIP_FROM_COMPANY || "Cardbit LLC",
    street1: env.CARDBIT_SHIP_FROM_STREET1 || "",
    street2: env.CARDBIT_SHIP_FROM_STREET2 || "",
    city: env.CARDBIT_SHIP_FROM_CITY || "",
    state: env.CARDBIT_SHIP_FROM_STATE || "",
    zip: env.CARDBIT_SHIP_FROM_ZIP || "",
    country: "US",
    phone: env.CARDBIT_SHIP_FROM_PHONE || "",
    email: env.CARDBIT_SHIP_FROM_EMAIL || "hello@cardbit.com",
  };
}

// ---------- quote ----------

export function quoteShipment(cardCount: number, method: FeeMethod, valueBits = 0) {
  const fee = shippingFee(cardCount, method, valueBits);
  return { fee, cardsUntilFree: cardsUntilFree(cardCount), processWithinHours: 48 };
}

/** Normalizes untrusted form input to an Address. Throws ADDRESS_INVALID with field messages. */
export function parseAddress(raw: unknown): Address {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const f = (k: string, max = 120) => (typeof src[k] === "string" ? String(src[k]).trim().slice(0, max) : "");
  const a: Address = {
    name: f("name", 80),
    company: f("company", 80),
    street1: f("street1"),
    street2: f("street2"),
    city: f("city", 60),
    state: f("state", 20).toUpperCase(),
    zip: f("zip", 10),
    country: (f("country", 2) || "US").toUpperCase(),
    phone: f("phone", 20),
    email: f("email", 254),
  };
  const missing: string[] = [];
  if (!a.name) missing.push("Enter the recipient's name.");
  if (!a.street1) missing.push("Enter the street address.");
  if (!a.city) missing.push("Enter the city.");
  if (!US_STATES.has(a.state)) missing.push("Pick a state.");
  if (!/^\d{5}(-\d{4})?$/.test(a.zip)) missing.push("Enter a 5-digit ZIP code.");
  if (missing.length) throw new ShippingError("Check the delivery address.", "ADDRESS_INVALID", missing);
  return a;
}

// ---------- create ----------

/** Total card value of the customer's copies: copy retail, else Card Broker retail, else buyback (the store's priceBits fallback). */
export async function shipmentValueBits(db: ShippingDeps["db"], customerId: string, copyIds: string[]) {
  if (!copyIds.length) return 0;
  const copies = await db.siteCopy.findMany({
    where: { id: { in: copyIds }, ownerId: customerId },
    select: { printingKey: true, condition: true, retailBits: true },
  });
  const prices = await db.sitePrice.findMany({ where: { printingKey: { in: [...new Set(copies.map((c) => priceKey(c.printingKey, c.condition)))] } } });
  const byKey = new Map(prices.map((p) => [p.printingKey, p]));
  return copies.reduce((sum, c) => {
    const p = byKey.get(priceKey(c.printingKey, c.condition));
    return sum + (c.retailBits ?? p?.retailBits ?? p?.buybackBits ?? 0);
  }, 0);
}

export type CreateShipmentInput = {
  customerId: string;
  customerEmail: string;
  copyIds: string[];
  address: Address;
  /** Billing address on file. Cardbits-paid fees have none; the delivery address stands in. */
  billing?: { country: string; state: string } | null;
  ip: string | null;
  method: FeeMethod;
  /** Server-verified USD capture reference when method = USD. */
  paymentRef?: string | null;
  /** Client-supplied key (one per "Ship these cards" click). Replays return the same shipment. */
  idempotencyKey: string;
};

export async function createShipment(deps: ShippingDeps, input: CreateShipmentInput) {
  const { db } = deps;
  const key = `ship:${input.customerId}:${input.idempotencyKey}`.slice(0, 190);

  const existing = await db.siteShipment.findUnique({ where: { idempotencyKey: key }, include: { items: true } });
  if (existing) {
    if (existing.customerId !== input.customerId) throw new ShippingError("Shipment not found.", "NOT_FOUND");
    return { shipment: existing, replay: true };
  }

  const copyIds = [...new Set(input.copyIds)];
  if (copyIds.length !== input.copyIds.length)
    throw new ShippingError("A card was picked twice.", "DUPLICATE_COPY");
  const fee: ShippingFee = shippingFee(copyIds.length, input.method, await shipmentValueBits(db, input.customerId, copyIds));

  const billing = input.billing ?? { country: input.address.country, state: input.address.state };
  await assertAllowedRegion(
    {
      action: "shipping",
      billing,
      shipping: { country: input.address.country, state: input.address.state },
      ip: input.ip,
    },
    deps.geo,
  );

  // Carrier address validation. Without a provider (local dev) we keep the typed address unvalidated.
  let address = input.address;
  let validated = false;
  if (deps.provider) {
    const check = await deps.provider.validateAddress(input.address);
    if (!check.valid)
      throw new ShippingError(
        "We couldn't verify that address with the carrier.",
        "ADDRESS_INVALID",
        check.messages.length ? check.messages : ["Check the street, city, state and ZIP."],
      );
    address = { ...check.address, email: input.address.email, phone: input.address.phone };
    validated = true;
    // The carrier may correct the state; recheck the normalized one.
    await assertAllowedRegion(
      { action: "shipping", billing: input.billing ?? { country: address.country, state: address.state }, shipping: { country: address.country, state: address.state } },
      null,
    );
  }

  if (fee.kind === "USD") {
    if (!deps.fees.verifyUsd)
      throw new FeePaymentError("Pay the shipping fee with Cardbits.", "USD_DISABLED");
    const ok = input.paymentRef
      ? await deps.fees.verifyUsd(input.paymentRef, fee.cents, input.customerId, `ship:${key}`)
      : false;
    if (!ok) throw new FeePaymentError("We couldn't confirm the $6 shipping payment.", "PAYMENT_NOT_VERIFIED");
  }

  const now = deps.now?.() ?? new Date();
  let shipment;
  try {
    shipment = await db.$transaction(async (tx) => {
      const created = await tx.siteShipment.create({
        data: {
          customerId: input.customerId,
          status: "DRAFT",
          toName: address.name,
          toEmail: input.customerEmail,
          toAddress: address as object,
          addressValidated: validated,
          cardCount: copyIds.length,
          feeKind: fee.kind,
          feeBits: fee.bits,
          feeCents: fee.cents,
          paymentRef: fee.kind === "USD" ? input.paymentRef ?? null : null,
          idempotencyKey: key,
          processBy: processBy(now),
          createdAt: now,
        },
      });
      const locked = await deps.copies.lockForShipment(tx, input.customerId, copyIds, created.id);
      if (locked.length !== copyIds.length)
        throw new CopyLockError("Some cards are no longer in your vault.", copyIds.filter((id) => !locked.some((l) => l.id === id)));
      await tx.siteShipmentItem.createMany({
        data: locked.map((c) => ({
          shipmentId: created.id,
          copyId: c.id,
          title: c.title,
          image: c.image,
          slot: c.slot,
          pocket: c.pocket,
        })),
      });
      let paymentRef = created.paymentRef;
      if (fee.kind === "CARDBITS") {
        const debit = await deps.fees.debitBits(
          tx,
          input.customerId,
          fee.bits,
          `shipfee:${created.id}`,
          `Vault shipment ${created.id} (${copyIds.length} cards)`,
        );
        paymentRef = debit.ledgerId;
      }
      await tx.siteShipmentEvent.create({
        data: {
          shipmentId: created.id,
          kind: "created",
          fromStatus: null,
          toStatus: "PAID",
          actor: `customer:${input.customerId}`,
          detail: { fee, validated, cards: copyIds.length },
        },
      });
      return tx.siteShipment.update({
        where: { id: created.id },
        data: { status: "PAID", paymentRef },
        include: { items: true },
      });
    });
  } catch (err) {
    // Lost a race with the same click: return the winner.
    if (isUniqueViolation(err)) {
      const again = await db.siteShipment.findUnique({ where: { idempotencyKey: key }, include: { items: true } });
      if (again && again.customerId === input.customerId) return { shipment: again, replay: true };
    }
    throw err;
  }

  await safeNotify(deps, "shipment_created", shipment);
  return { shipment, replay: false };
}

// ---------- cancel (before label) ----------

export async function cancelShipment(deps: ShippingDeps, shipmentId: string, actor: string, reason: string) {
  const { db } = deps;
  return db.$transaction(async (tx) => {
    const s = await tx.siteShipment.findUnique({ where: { id: shipmentId }, include: { items: true } });
    if (!s) throw new ShippingError("Shipment not found.", "NOT_FOUND");
    if (s.status === "CANCELED") return s;
    const claimed = await tx.siteShipment.updateMany({
      where: { id: shipmentId, status: { in: ["DRAFT", "PAID"] } },
      data: { status: "CANCELED", canceledAt: deps.now?.() ?? new Date() },
    });
    if (claimed.count !== 1)
      throw new ShippingError("This shipment already has a label and can't be canceled here.", "WRONG_STATE");
    await deps.copies.release(tx, s.id, s.items.map((i) => i.copyId));
    if (s.feeKind === "CARDBITS" && s.feeBits > 0)
      await deps.fees.refundBits(tx, s.customerId, s.feeBits, `shipfee-refund:${s.id}`, `Canceled shipment ${s.id}`);
    await tx.siteShipmentEvent.create({
      data: { shipmentId: s.id, kind: "canceled", fromStatus: s.status, toStatus: "CANCELED", actor, detail: { reason } },
    });
    return tx.siteShipment.findUniqueOrThrow({ where: { id: s.id }, include: { items: true } });
  });
}

// ---------- Fix Card (staff, before a label) ----------

export type FixCardInput = {
  action: "swap" | "remove";
  copyId: string;
  /** shipment.updatedAt ISO string the desk last saw; a mismatch means someone else changed it. */
  revision?: string;
};

/**
 * Swap a picked copy for another filed copy of the same printing and condition, or remove it and
 * return it to the customer's vault. Only while the shipment is PAID (no label yet). The shipment row
 * is claimed first, so this serializes against buyLabel and against another desk's Fix Card.
 * The fee is unchanged: a shipment that qualified for free shipping stays free.
 */
export async function fixShipmentCard(deps: ShippingDeps, shipmentId: string, input: FixCardInput, actor: string) {
  return deps.db.$transaction(async (tx) => {
    const now = deps.now?.() ?? new Date();
    const s = await tx.siteShipment.findUnique({ where: { id: shipmentId }, include: { items: true } });
    if (!s) throw new ShippingError("Shipment not found.", "NOT_FOUND");
    if (input.revision && s.updatedAt.toISOString() !== input.revision)
      throw new ShippingError("This shipment changed. Refresh it.", "WRONG_STATE");
    const claim = await tx.siteShipment.updateMany({
      where: { id: shipmentId, status: "PAID", updatedAt: s.updatedAt },
      data: { updatedAt: now > s.updatedAt ? now : new Date(s.updatedAt.getTime() + 1) },
    });
    if (claim.count !== 1)
      throw new ShippingError(
        s.status === "PAID" ? "This shipment changed. Refresh it." : "Fix cards before buying the label.",
        "WRONG_STATE",
      );
    const item = s.items.find((i) => i.copyId === input.copyId);
    if (!item) throw new ShippingError("That card is no longer on this shipment.", "NOT_FOUND");

    if (input.action === "swap") {
      const next = await deps.copies.swapForShipment(tx, s.id, s.customerId, item.copyId, actor);
      await tx.siteShipmentItem.delete({ where: { id: item.id } });
      await tx.siteShipmentItem.create({
        data: { shipmentId: s.id, copyId: next.id, title: next.title, image: next.image, slot: next.slot, pocket: next.pocket },
      });
      await tx.siteShipmentEvent.create({
        data: { shipmentId: s.id, kind: "card_swapped", actor, detail: { from: item.copyId, to: next.id, title: next.title } },
      });
    } else {
      if (s.items.length <= 1)
        throw new ShippingError("This is the last card on the shipment. Cancel the shipment instead.", "WRONG_STATE");
      await deps.copies.release(tx, s.id, [item.copyId]);
      await tx.siteShipmentItem.delete({ where: { id: item.id } });
      await tx.siteShipment.update({ where: { id: s.id }, data: { cardCount: { decrement: 1 } } });
      await tx.siteShipmentEvent.create({
        data: { shipmentId: s.id, kind: "card_removed", actor, detail: { copyId: item.copyId, title: item.title, returnedTo: "vault" } },
      });
    }
    return tx.siteShipment.findUniqueOrThrow({ where: { id: s.id }, include: { items: true } });
  });
}

// ---------- label (staff) ----------

export function pickRate(rates: Rate[], services: string[] = DEFAULT_SERVICES): Rate | null {
  for (const token of services) {
    const match = rates.filter((r) => r.serviceToken === token).sort((a, b) => a.amountCents - b.amountCents)[0];
    if (match) return match;
  }
  return null;
}

export async function ratesForShipment(deps: ShippingDeps, shipmentId: string) {
  if (!deps.provider) throw new ShippingError("Connect Shippo first.", "PROVIDER_MISSING");
  const s = await deps.db.siteShipment.findUnique({ where: { id: shipmentId } });
  if (!s) throw new ShippingError("Shipment not found.", "NOT_FOUND");
  const rates = await deps.provider.rates(deps.from, s.toAddress as unknown as Address, parcelFor(s.cardCount), s.id);
  return { rates, suggested: pickRate(rates, deps.services) };
}

/**
 * Buys the label once. PAID -> LABEL_PENDING is a conditional claim, so two staff clicks
 * cannot buy two labels. On provider failure the shipment goes back to PAID.
 */
export async function buyLabel(deps: ShippingDeps, shipmentId: string, actor: string, rateId?: string) {
  const { db } = deps;
  if (!deps.provider) throw new ShippingError("Connect Shippo first.", "PROVIDER_MISSING");
  const claim = await db.siteShipment.updateMany({
    where: { id: shipmentId, status: "PAID", shippoTransactionId: null },
    data: { status: "LABEL_PENDING" },
  });
  if (claim.count !== 1) {
    const s = await db.siteShipment.findUnique({ where: { id: shipmentId }, include: { items: true } });
    if (!s) throw new ShippingError("Shipment not found.", "NOT_FOUND");
    if (s.shippoTransactionId) return s; // already bought
    throw new ShippingError(`This shipment is ${s.status.toLowerCase().replace("_", " ")}.`, "WRONG_STATE");
  }
  try {
    const s = await db.siteShipment.findUniqueOrThrow({ where: { id: shipmentId } });
    const rates = await deps.provider.rates(deps.from, s.toAddress as unknown as Address, parcelFor(s.cardCount), s.id);
    const rate = rateId ? rates.find((r) => r.rateId === rateId) ?? null : pickRate(rates, deps.services);
    if (!rate) throw new ShippingError("No matching carrier rate for this address.", "NO_RATE");
    const label = await deps.provider.buyLabel(rate.rateId, s.id);
    if (label.status !== "SUCCESS" || !label.trackingNumber)
      throw new ShippingError("The carrier didn't issue the label.", "LABEL_FAILED", label.messages);
    return await db.$transaction(async (tx) => {
      await tx.siteShipmentEvent.create({
        data: {
          shipmentId,
          kind: "label_purchased",
          fromStatus: "LABEL_PENDING",
          toStatus: "LABEL_PURCHASED",
          actor,
          detail: { carrier: rate.carrier, service: rate.service, cents: rate.amountCents },
        },
      });
      return tx.siteShipment.update({
        where: { id: shipmentId },
        data: {
          status: "LABEL_PURCHASED",
          shippoShipmentId: rate.shipmentId,
          shippoRateId: rate.rateId,
          shippoTransactionId: label.transactionId,
          carrier: rate.carrier.toLowerCase(),
          service: rate.service,
          postageCents: rate.amountCents,
          trackingNumber: label.trackingNumber,
          trackingUrl: label.trackingUrl,
          labelUrl: label.labelUrl,
          trackingStatus: "PRE_TRANSIT",
        },
        include: { items: true },
      });
    });
  } catch (err) {
    await db.siteShipment.updateMany({ where: { id: shipmentId, status: "LABEL_PENDING" }, data: { status: "PAID" } });
    await db.siteShipmentEvent.create({
      data: {
        shipmentId,
        kind: "label_failed",
        actor,
        detail: { error: err instanceof Error ? err.message : String(err) },
      },
    });
    throw err;
  }
}

// ---------- hand-off and tracking ----------

const ORDER: Record<string, number> = {
  PAID: 1, LABEL_PENDING: 2, LABEL_PURCHASED: 3, IN_TRANSIT: 4, EXCEPTION: 4, RETURNED: 5, DELIVERED: 5,
};

/** Staff "dropped at carrier" or first carrier scan: copies leave the vault, customer gets the shipped email. */
export async function markShipped(deps: ShippingDeps, shipmentId: string, actor: string) {
  return applyStatus(deps, shipmentId, "IN_TRANSIT", actor, null, null);
}

async function applyStatus(
  deps: ShippingDeps,
  shipmentId: string,
  to: ShipmentStatus,
  actor: string,
  tracking: Tracking | null,
  dedupeKey: string | null,
) {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const result = await db.$transaction(async (tx) => {
    if (dedupeKey) {
      const seen = await tx.siteShipmentEvent.findUnique({ where: { dedupeKey } });
      if (seen) return { changed: false, shipment: await tx.siteShipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { items: true } }) };
    }
    const s = await tx.siteShipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { items: true } });
    // Only move forward; tracking can arrive out of order. EXCEPTION can recover to TRANSIT/DELIVERED.
    const forward =
      (ORDER[to] ?? 0) > (ORDER[s.status] ?? 0) || (s.status === "EXCEPTION" && (to === "IN_TRANSIT" || to === "DELIVERED"));
    if (!forward || !["LABEL_PURCHASED", "IN_TRANSIT", "EXCEPTION"].includes(s.status)) {
      if (dedupeKey)
        await tx.siteShipmentEvent.create({
          data: { shipmentId, kind: "tracking_ignored", actor, dedupeKey, detail: tracking ?? undefined, fromStatus: s.status, toStatus: to },
        });
      return { changed: false, shipment: s };
    }
    const claimed = await tx.siteShipment.updateMany({
      where: { id: shipmentId, status: s.status },
      data: {
        status: to,
        trackingStatus: tracking?.status ?? (to === "IN_TRANSIT" ? "TRANSIT" : s.trackingStatus),
        trackingDetail: tracking?.detail ?? s.trackingDetail,
        shippedAt: s.shippedAt ?? (to === "IN_TRANSIT" || to === "DELIVERED" ? now : null),
        deliveredAt: to === "DELIVERED" ? (tracking?.at ? new Date(tracking.at) : now) : s.deliveredAt,
      },
    });
    if (claimed.count !== 1) return { changed: false, shipment: s };
    if (!s.shippedAt && (to === "IN_TRANSIT" || to === "DELIVERED"))
      await deps.copies.markShipped(tx, s.id, s.items.map((i) => i.copyId));
    await tx.siteShipmentEvent.create({
      data: { shipmentId, kind: "status", fromStatus: s.status, toStatus: to, actor, dedupeKey, detail: tracking ?? undefined },
    });
    return {
      changed: true,
      wasShipped: Boolean(s.shippedAt),
      shipment: await tx.siteShipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { items: true } }),
    };
  });
  if (result.changed) {
    if ((to === "IN_TRANSIT" || to === "DELIVERED") && !("wasShipped" in result && result.wasShipped))
      await safeNotify(deps, "shipment_shipped", result.shipment);
    if (to === "DELIVERED") await safeNotify(deps, "shipment_delivered", result.shipment);
  }
  return result.shipment;
}

export function statusFromTracking(t: Tracking["status"]): ShipmentStatus | null {
  switch (t) {
    case "TRANSIT": return "IN_TRANSIT";
    case "DELIVERED": return "DELIVERED";
    case "RETURNED": return "RETURNED";
    case "FAILURE": return "EXCEPTION";
    default: return null; // UNKNOWN / PRE_TRANSIT: no change
  }
}

/**
 * Shippo track_updated webhook. The URL carries a secret token (Shippo doesn't sign webhooks);
 * the body is only a hint: we re-read tracking from Shippo before changing anything.
 */
export async function handleTrackingWebhook(deps: ShippingDeps, body: unknown) {
  const b = (body && typeof body === "object" ? body : {}) as { event?: string; data?: Record<string, unknown> };
  if (b.event !== "track_updated" || !b.data) return { ok: true, ignored: "event" as const };
  const number = String(b.data.tracking_number ?? "");
  const carrier = String(b.data.carrier ?? "");
  if (!number) return { ok: true, ignored: "no_number" as const };
  const s = await deps.db.siteShipment.findFirst({ where: { trackingNumber: number } });
  if (!s) return { ok: true, ignored: "unknown_number" as const };
  if (!deps.provider) throw new ShippingError("Connect Shippo first.", "PROVIDER_MISSING");
  const t = await deps.provider.track(s.carrier || carrier, number);
  const to = statusFromTracking(t.status);
  if (!to) return { ok: true, ignored: "pre_transit" as const };
  const dedupe = `track:${number}:${t.status}:${t.at ?? ""}`.slice(0, 190);
  const shipment = await applyStatus(deps, s.id, to, "shippo", t, dedupe);
  return { ok: true, status: shipment.status };
}

// ---------- staff queue ----------

/** Paid shipments without a label, oldest first, with whether they've passed the 48h promise. */
export async function shippingQueue(db: PrismaClient, now = new Date()) {
  const rows = await db.siteShipment.findMany({
    where: { status: { in: ["PAID", "LABEL_PENDING", "LABEL_PURCHASED", "EXCEPTION", "RETURNED"] } },
    orderBy: { processBy: "asc" },
    include: { items: true },
    take: 200,
  });
  return rows.map((r) => ({ ...r, overdue: ["PAID", "LABEL_PENDING"].includes(r.status) && r.processBy < now }));
}

// ---------- helpers ----------

async function safeNotify(deps: ShippingDeps, kind: ShipEmailKind, s: SiteShipment & { items: { title: string }[] }) {
  if (!deps.notify) return;
  try {
    await deps.notify(kind, s);
  } catch (err) {
    console.error(`[site-shipping] ${kind} email for ${s.id} failed`, err);
  }
}

function isUniqueViolation(err: unknown) {
  return Boolean(err && typeof err === "object" && (err as { code?: string }).code === "P2002");
}

export { CopyLockError, FeePaymentError };
