/**
 * Sparks: Cardbit's consolation currency. When a paid pack's pulled buyback value is below the
 * Cardbits paid, the customer earns 5% of the gap as Sparks. Sparks have no cash value, cannot be
 * transferred and are spent only in the Spark Shop.
 */
export const SPARK_RATE_PERCENT = 5;

/** Sparks for one paid opening. Values are whole Cardbits. */
export function sparksForOpening(paidCardbits: number, pulledValueCardbits: number) {
  if (!Number.isSafeInteger(paidCardbits) || !Number.isSafeInteger(pulledValueCardbits)) return 0;
  const gap = paidCardbits - Math.max(0, pulledValueCardbits);
  return gap > 0 ? Math.floor((gap * SPARK_RATE_PERCENT) / 100) : 0;
}

/**
 * Standalone site Spark Shop (Trevor, Nov 26 2026): about 500 Sparks per $1 of card value, i.e. 5 Sparks per
 * Cardbit of the card's Cardbit price (its Card Shop retail). Every card has its own price.
 */
export const SPARKS_PER_CARDBIT = 5;
export function siteSparkPrice(valueCardbits: number | null) {
  if (valueCardbits == null || !Number.isSafeInteger(valueCardbits) || valueCardbits <= 0) return null;
  return valueCardbits * SPARKS_PER_CARDBIT;
}

/** Shopify Spark Shop tiers, about 5 Sparks per Cardbit of the card's value. Pricier cards are not eligible. */
export const SPARK_TIERS = [
  { tier: 1, maxValueCardbits: 50, sparks: 250 },
  { tier: 2, maxValueCardbits: 100, sparks: 500 },
  { tier: 3, maxValueCardbits: 200, sparks: 1000 },
] as const;

export function sparkPrice(valueCardbits: number) {
  if (!Number.isSafeInteger(valueCardbits) || valueCardbits <= 0) return null;
  return SPARK_TIERS.find((t) => valueCardbits <= t.maxValueCardbits) ?? null;
}
