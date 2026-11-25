// Cardbits wallet for the standalone site. Every balance change is one SiteLedger row with a
// unique idempotency key; replays return the original row and never move the balance twice.
// The wallet balance can never go below zero (CHECK constraint + conditional update).
import type { Prisma, PrismaClient, SiteLedger } from "@prisma/client";

export type LedgerKind =
  | "TOPUP"
  | "BONUS"
  | "PACK"
  | "SINGLE"
  | "BUYBACK"
  | "SHIPPING"
  | "REFUND"
  | "CHARGEBACK"
  | "ADJUST"
  | "REWARD"
  | "SUBSCRIPTION";

export class InsufficientCardbits extends Error {
  code = "insufficient_bits";
  constructor(readonly balance: number, readonly needed: number) {
    super("Not enough Cardbits.");
  }
}

type Tx = Prisma.TransactionClient;
export type LedgerEntry = {
  customerId: string;
  delta: number;
  kind: LedgerKind;
  idempotencyKey: string;
  ref?: string | null;
  note?: string | null;
};

/** Apply inside the caller's transaction. Returns the ledger row and whether it was new. */
export async function applyLedger(tx: Tx, e: LedgerEntry): Promise<{ entry: SiteLedger; replay: boolean }> {
  if (!Number.isSafeInteger(e.delta) || e.delta === 0) throw Error("Ledger delta must be a non-zero integer.");
  if (!e.idempotencyKey || e.idempotencyKey.length > 190) throw Error("Ledger idempotency key required.");
  const prior = await tx.siteLedger.findUnique({ where: { idempotencyKey: e.idempotencyKey } });
  if (prior) {
    if (prior.customerId !== e.customerId || prior.delta !== e.delta || prior.kind !== e.kind)
      throw Error("Idempotency key reused for a different ledger entry.");
    return { entry: prior, replay: true };
  }
  await tx.siteWallet.upsert({ where: { customerId: e.customerId }, create: { customerId: e.customerId }, update: {} });
  const rows = await tx.$queryRaw<{ balance: number }[]>`
    UPDATE "SiteWallet" SET balance = balance + ${e.delta}, "updatedAt" = now()
    WHERE "customerId" = ${e.customerId} AND balance + ${e.delta} >= 0
    RETURNING balance`;
  if (!rows.length) {
    const w = await tx.siteWallet.findUnique({ where: { customerId: e.customerId } });
    throw new InsufficientCardbits(w?.balance ?? 0, -e.delta);
  }
  const entry = await tx.siteLedger.create({
    data: {
      customerId: e.customerId,
      delta: e.delta,
      balanceAfter: rows[0].balance,
      kind: e.kind,
      ref: e.ref ?? null,
      note: e.note ?? null,
      idempotencyKey: e.idempotencyKey,
    },
  });
  return { entry, replay: false };
}

/** Standalone helper: its own serializable-safe transaction, retried once on a key race. */
export async function postLedger(db: PrismaClient, e: LedgerEntry) {
  try {
    return await db.$transaction((tx) => applyLedger(tx, e));
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return db.$transaction((tx) => applyLedger(tx, e));
    throw err;
  }
}

export async function balanceOf(db: PrismaClient | Tx, customerId: string) {
  return (await db.siteWallet.findUnique({ where: { customerId } }))?.balance ?? 0;
}

/** Top-up packages (base Cardbits → bonus). Price in cents = base. 100 Cardbits = $1. */
export const TOPUP_PACKAGES: Record<number, { cents: number; bonus: number }> = {
  1000: { cents: 1000, bonus: 0 },
  5000: { cents: 5000, bonus: 0 },
  10000: { cents: 10000, bonus: 500 },
  50000: { cents: 50000, bonus: 5000 },
};
