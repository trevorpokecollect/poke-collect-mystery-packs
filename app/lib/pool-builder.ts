// Picks a pool of cards from inventory so the average value lands on a target,
// and assigns each card a tier from its value. Pure functions, no Shopify or database.

export interface TierRule {
  name: string;
  /** Lowest value (inclusive) for this tier. */
  min: number;
}

// Poke-Collect's tiers: Poke up to $5, Great up to $10, Ultra up to $25, Master above that.
export const DEFAULT_TIER_RULES: TierRule[] = [
  { name: "Poke", min: 0 },
  { name: "Great", min: 5.01 },
  { name: "Ultra", min: 10.01 },
  { name: "Master", min: 25.01 },
];

/** Parses and sorts tier rules (lowest first). Throws on anything malformed. */
export function normalizeTierRules(rules: unknown): TierRule[] {
  if (!Array.isArray(rules) || rules.length === 0) throw new Error("Add at least one tier.");
  const parsed = rules.map((r) => {
    const name = String((r as TierRule)?.name ?? "").trim();
    const min = Number((r as TierRule)?.min);
    if (!name || !Number.isFinite(min) || min < 0) throw new Error("Each tier needs a name and a starting value.");
    return { name, min };
  });
  parsed.sort((a, b) => a.min - b.min);
  if (new Set(parsed.map((r) => r.min)).size !== parsed.length) throw new Error("Two tiers start at the same value.");
  if (new Set(parsed.map((r) => r.name.toLowerCase())).size !== parsed.length) throw new Error("Two tiers share a name.");
  return parsed;
}

/** The tier for a value: the highest tier whose starting value it reaches. */
export function tierFor(value: number, rules: TierRule[]): string {
  let tier = rules[0].name;
  for (const rule of rules) if (value >= rule.min) tier = rule.name;
  return tier;
}

export interface Candidate {
  variantId: string;
  value: number;
  /** Copies in stock. Defaults to 1. */
  available?: number;
}

export interface BuildRules {
  /** Total cards in the pool, counting copies (one card per pack). */
  count: number;
  minValue: number;
  maxValue: number;
  targetAverage: number;
  /** Most copies of one card the pool may hold. Defaults to 1. */
  maxCopies?: number;
  /** At least this many cards (copies) worth `hitValue` or more. Defaults to 0. */
  minHits?: number;
  hitValue?: number;
  /** A second, higher floor: at least `minBigHits` cards worth `bigHitValue` or more. */
  minBigHits?: number;
  bigHitValue?: number;
  /** A third, highest floor: at least `minTopHits` cards worth `topHitValue` or more. */
  minTopHits?: number;
  topHitValue?: number;
  /** Non-hit cards cost at most this; cards between it and `hitValue` are left out. */
  fillerMax?: number;
}

export interface BuildResult<C extends Candidate> {
  cards: (C & { quantity: number })[];
  total: number;
  average: number;
}

/** Store rule: pools over 50 cards may hold up to 3 copies of a card; smaller pools hold one of each. */
export function copiesAllowed(count: number) {
  return count > 50 ? 3 : 1;
}

export function validateBuildRules(rules: BuildRules) {
  const { count, minValue, maxValue, targetAverage } = rules;
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error("Card count must be a whole number from 1 to 1000.");
  if (!(minValue >= 0) || !(maxValue > minValue)) throw new Error("The value range needs a lower and a higher value.");
  if (!(targetAverage >= minValue && targetAverage <= maxValue)) {
    throw new Error("The target average has to sit inside the value range.");
  }
  const minHits = rules.minHits ?? 0;
  if (!Number.isInteger(minHits) || minHits < 0 || minHits > count) throw new Error("Minimum hits must be a whole number up to the card count.");
  if (minHits > 0 && !(Number(rules.hitValue) > minValue && Number(rules.hitValue) <= maxValue)) {
    throw new Error("The hit value has to sit inside the value range.");
  }
  const minBigHits = rules.minBigHits ?? 0;
  if (!Number.isInteger(minBigHits) || minBigHits < 0 || minBigHits > count) throw new Error("Minimum big hits must be a whole number up to the card count.");
  if (minBigHits > 0 && !(Number(rules.bigHitValue) > minValue && Number(rules.bigHitValue) <= maxValue)) {
    throw new Error("The big hit value has to sit inside the value range.");
  }
  const minTopHits = rules.minTopHits ?? 0;
  if (!Number.isInteger(minTopHits) || minTopHits < 0 || minTopHits > count) throw new Error("Minimum top hits must be a whole number up to the card count.");
  if (minTopHits > 0 && !(Number(rules.topHitValue) > minValue && Number(rules.topHitValue) <= maxValue)) {
    throw new Error("The top hit value has to sit inside the value range.");
  }
  if (rules.fillerMax && !(rules.fillerMax >= minValue && rules.fillerMax < Number(rules.hitValue ?? Infinity))) {
    throw new Error("The filler max has to sit between the lowest card value and the hit value.");
  }
}

const cents = (n: number) => Math.round(n * 100);

/**
 * Chooses `count` cards inside the value range whose average is as close to the target as
 * the inventory allows, taking up to `maxCopies` copies of a card (never more than are in
 * stock). Starts from a random sample, then repeatedly swaps a picked copy for the unpicked
 * copy that best closes the gap.
 */
export function buildPool<C extends Candidate>(
  candidates: C[],
  rules: BuildRules,
  random: () => number = Math.random,
): BuildResult<C> {
  validateBuildRules(rules);
  const maxCopies = Math.max(1, Math.floor(rules.maxCopies ?? 1));
  // One entry per copy that may go in the pool.
  const eligible = candidates
    .filter((c) => c.value >= rules.minValue && c.value <= rules.maxValue)
    .filter((c) => !(rules.fillerMax && rules.hitValue) || c.value <= rules.fillerMax || c.value >= rules.hitValue)
    .flatMap((c) => Array.from({ length: Math.min(maxCopies, Math.max(1, Math.floor(c.available ?? 1))) }, () => c));
  if (eligible.length < rules.count) {
    throw new Error(
      `Only ${eligible.length} cards in stock match these rules, and the pool needs ${rules.count}.`,
    );
  }

  // Random start (Fisher-Yates over the eligible list).
  const shuffled = [...eligible];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // Guaranteed hits, highest floor first: each floor's first copies go in, then the rest of
  // the random order. A floor counts every picked card at or above its value.
  const floors = [
    { value: Number(rules.topHitValue ?? Infinity), min: rules.minTopHits ?? 0 },
    { value: Number(rules.bigHitValue ?? Infinity), min: rules.minBigHits ?? 0 },
    { value: Number(rules.hitValue ?? Infinity), min: rules.minHits ?? 0 },
  ]
    .filter((f) => f.min > 0)
    .sort((a, b) => b.value - a.value)
    .map((f) => ({ cents: cents(f.value), value: f.value, min: f.min, have: 0 }));
  const chosen = new Set<C>();
  for (const f of floors) {
    const already = [...chosen].filter((c) => cents(c.value) >= f.cents).length;
    const extra = shuffled.filter((c) => !chosen.has(c) && cents(c.value) >= f.cents).slice(0, Math.max(0, f.min - already));
    if (already + extra.length < f.min) {
      throw new Error(`Only ${already + extra.length} cards in stock are worth $${f.value} or more, and the pool needs ${f.min}.`);
    }
    extra.forEach((c) => chosen.add(c));
  }
  if (chosen.size > rules.count) throw new Error("The minimum hits add up to more cards than the pool holds.");
  shuffled.splice(0, shuffled.length, ...chosen, ...shuffled.filter((c) => !chosen.has(c)));
  const picked = shuffled.slice(0, rules.count);
  const countFloors = () => floors.forEach((f) => (f.have = picked.filter((c) => cents(c.value) >= f.cents).length));
  countFloors();
  // Unpicked cards sorted by value, so the best swap partner is a binary search away.
  const pool = shuffled.slice(rules.count).sort((a, b) => a.value - b.value);

  const goal = cents(rules.targetAverage) * rules.count;
  let total = picked.reduce((sum, c) => sum + cents(c.value), 0);

  // First index whose value is >= want (pool.length if none).
  const lowerBound = (want: number) => {
    let lo = 0;
    let hi = pool.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cents(pool[mid].value) < want) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const closest = (want: number) => {
    const i = lowerBound(want);
    if (i === pool.length) return i - 1;
    if (i > 0 && want - cents(pool[i - 1].value) <= cents(pool[i].value) - want) return i - 1;
    return i;
  };

  for (let round = 0; round < 20_000 && total !== goal && pool.length > 0; round++) {
    const gap = goal - total;
    const i = Math.floor(random() * picked.length);
    const out = picked[i];
    // A card a floor needs to keep its minimum can only be swapped for one at or above that floor.
    const floorCents = Math.max(0, ...floors.filter((f) => cents(out.value) >= f.cents && f.have <= f.min).map((f) => f.cents));
    let j = closest(cents(out.value) + gap);
    // The nearest card may sit just under the floor; take the cheapest card at the floor instead.
    if (j >= 0 && j < pool.length && cents(pool[j].value) < floorCents) j = lowerBound(floorCents);
    if (j < 0 || j >= pool.length) continue;
    const into = pool[j];
    const newGap = gap - (cents(into.value) - cents(out.value));
    if (Math.abs(newGap) >= Math.abs(gap)) continue;
    for (const f of floors) f.have += (cents(into.value) >= f.cents ? 1 : 0) - (cents(out.value) >= f.cents ? 1 : 0);
    picked[i] = into;
    pool.splice(j, 1);
    pool.splice(lowerBound(cents(out.value)), 0, out);
    total += cents(into.value) - cents(out.value);
  }

  // Collapse copies back into one entry per card.
  const byVariant = new Map<string, C & { quantity: number }>();
  for (const c of picked) {
    const entry = byVariant.get(c.variantId);
    if (entry) entry.quantity += 1;
    else byVariant.set(c.variantId, { ...c, quantity: 1 });
  }
  const cards = [...byVariant.values()].sort((a, b) => b.value - a.value);
  return { cards, total: total / 100, average: total / 100 / rules.count };
}
