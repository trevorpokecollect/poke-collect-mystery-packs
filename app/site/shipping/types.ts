// Contracts the shipping module needs from the rest of the site (agreed with the lead, Nov 24 2026).
// The lead implements CopyStore on SiteCopy and FeePayer on the Cardbits wallet ledger.

import type { Prisma } from "@prisma/client";

export type Tx = Prisma.TransactionClient;

export type LockedCopy = { id: string; title: string; slot: number | null; pocket: number | null };

export class CopyLockError extends Error {
  constructor(message: string, public unavailable: string[]) {
    super(message);
    this.name = "CopyLockError";
  }
}

export interface CopyStore {
  /**
   * Moves the customer's whole selection VAULTED -> SHIP_LOCKED with conditional updates
   * (WHERE id = ? AND status = 'VAULTED' AND ownerId = ?). Rejects the entire set with
   * CopyLockError if any copy is not VAULTED for that customer. Runs inside `tx`.
   */
  lockForShipment(tx: Tx, customerId: string, copyIds: string[], shipmentId: string): Promise<LockedCopy[]>;
  /** SHIP_LOCKED -> VAULTED for every copy on the shipment (cancel before label). */
  release(tx: Tx, shipmentId: string, copyIds: string[]): Promise<void>;
  /** SHIP_LOCKED -> SHIPPED for every copy on the shipment (left the building). Idempotent. */
  markShipped(tx: Tx, shipmentId: string, copyIds: string[]): Promise<void>;
}

export class FeePaymentError extends Error {
  constructor(message: string, public code: "INSUFFICIENT_BITS" | "PAYMENT_NOT_VERIFIED" | "USD_DISABLED") {
    super(message);
    this.name = "FeePaymentError";
  }
}

export interface FeePayer {
  /** Debit Cardbits inside `tx`. Same idempotencyKey twice = one debit. Throws FeePaymentError INSUFFICIENT_BITS. */
  debitBits(tx: Tx, customerId: string, bits: number, idempotencyKey: string, memo: string): Promise<{ ledgerId: string }>;
  /** Return a shipping fee debit (shipment canceled before a label). Idempotent per key. */
  refundBits(tx: Tx, customerId: string, bits: number, idempotencyKey: string, memo: string): Promise<{ ledgerId: string }>;
  /**
   * Optional: confirm a server-verified USD capture (e.g. Coinflow) of `cents` for this customer and
   * purpose. Absent = USD shipping fee not offered (Trevor hasn't decided card payments yet).
   */
  verifyUsd?(paymentRef: string, cents: number, customerId: string, purpose: string): Promise<boolean>;
}
