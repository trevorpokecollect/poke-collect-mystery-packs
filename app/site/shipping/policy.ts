// Published vault shipping policy (Trevor, Nov 24 2026):
// $6 or 600 Cardbits per shipment, free for shipments over 30 cards, US only,
// processed within 48 hours. Pure functions so the UI and server quote the same way.

export const SHIPPING_FEE_CENTS = 600;
export const SHIPPING_FEE_BITS = 600;
export const FREE_SHIPPING_OVER = 30; // strictly more than 30 cards ships free
export const PROCESS_WITHIN_HOURS = 48;
export const MAX_CARDS_PER_SHIPMENT = 500;

export type FeeMethod = "CARDBITS" | "USD";
export type FeeKind = "FREE" | FeeMethod;

export type ShippingFee = { kind: FeeKind; bits: number; cents: number };

export function shippingFee(cardCount: number, method: FeeMethod): ShippingFee {
  if (!Number.isInteger(cardCount) || cardCount < 1) throw new RangeError("Pick at least one card to ship.");
  if (cardCount > MAX_CARDS_PER_SHIPMENT)
    throw new RangeError(`Ship up to ${MAX_CARDS_PER_SHIPMENT} cards at a time.`);
  if (cardCount > FREE_SHIPPING_OVER) return { kind: "FREE", bits: 0, cents: 0 };
  return method === "CARDBITS"
    ? { kind: "CARDBITS", bits: SHIPPING_FEE_BITS, cents: 0 }
    : { kind: "USD", bits: 0, cents: SHIPPING_FEE_CENTS };
}

export function processBy(createdAt: Date): Date {
  return new Date(createdAt.getTime() + PROCESS_WITHIN_HOURS * 3_600_000);
}

/** Cards left to add before the shipment ships free (0 when already free). */
export function cardsUntilFree(cardCount: number) {
  return Math.max(0, FREE_SHIPPING_OVER + 1 - cardCount);
}

// ---- Parcel sizing ----
// Singles ship in penny sleeve + toploader inside a team bag. Measured defaults, overridable by env.
export type Parcel = { length: number; width: number; height: number; weightOz: number; template: string };

export function parcelFor(cardCount: number, env: NodeJS.ProcessEnv = process.env): Parcel {
  const perCardOz = Number(env.CARDBIT_SHIP_OZ_PER_CARD ?? 0.25); // sleeve + toploader
  const baseOz = Number(env.CARDBIT_SHIP_BASE_OZ ?? 1.5); // bubble mailer + slip
  const weightOz = Math.round((baseOz + perCardOz * cardCount) * 10) / 10;
  if (cardCount <= 8) return { length: 7.5, width: 5.5, height: 0.5, weightOz, template: "mailer-small" };
  if (cardCount <= 30) return { length: 10, width: 7, height: 1.5, weightOz, template: "mailer-large" };
  if (cardCount <= 120) return { length: 8, width: 6, height: 4, weightOz, template: "box-small" };
  return { length: 12, width: 9, height: 6, weightOz, template: "box-medium" };
}
