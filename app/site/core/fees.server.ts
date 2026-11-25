// Shipping fees paid from the Cardbits wallet (FeePayer for the shipping service).
import type { FeePayer, Tx } from "../shipping/types";
import { FeePaymentError } from "../shipping/types";
import { applyLedger, InsufficientCardbits } from "./ledger.server";

export const ledgerFeePayer: FeePayer = {
  async debitBits(tx: Tx, customerId, bits, idempotencyKey, memo) {
    try {
      const { entry } = await applyLedger(tx, { customerId, delta: -bits, kind: "SHIPPING", idempotencyKey, note: memo });
      return { ledgerId: entry.id };
    } catch (e) {
      if (e instanceof InsufficientCardbits) throw new FeePaymentError("Not enough Cardbits for shipping.", "INSUFFICIENT_BITS");
      throw e;
    }
  },
  async refundBits(tx: Tx, customerId, bits, idempotencyKey, memo) {
    const { entry } = await applyLedger(tx, { customerId, delta: bits, kind: "REFUND", idempotencyKey, note: memo });
    return { ledgerId: entry.id };
  },
  // verifyUsd intentionally absent: USD shipping fees stay off until Trevor decides on card payments.
};
