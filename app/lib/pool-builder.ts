// Picks a pool of cards from inventory so the average value lands on a target,
// and assigns each card a tier from its value. Pure functions, no Shopify or database.

export interface TierRule {
  name: string;
  /** Lowest value (inclusive) for this tier. */
  min: number;
}

export const DEFAULT_TIER_RULES: TierRule[] = [
  { name: "Poke", min: 0 },
  { name: "Great", min: 10 },
  { name: "Ultra", min: 25 },
  { name: "Master", min: 50 },
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
}

export interface BuildRules {
  count: number;
  minValue: number;
  maxValue: number;
  targetAverage: number;
}

export interface BuildResult<C extends Candidate> {
  cards: C[];
  total: number;
  average: number;
}

export function validateBuildRules(rules: BuildRules) {
  const { count, minValue, maxValue, targetAverage } = rules;
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error("Card count must be a whole number from 1 to 1000.");
  if (!(minValue >= 0) || !(maxValue > minValue)) throw new Error("The value range needs a lower and a higher value.");
  if (!(targetAverage >= minValue && targetAverage <= maxValue)) {
    throw new Error("The target average has to sit inside the value range.");
  }
}

const cents = (n: number) => Math.round(n * 100);

/**
 * Chooses `count` distinct candidates inside the value range whose average is as close
 * to the target as the inventory allows. Starts from a random sample, then repeatedly
 * swaps a picked card for the unpicked card that best closes the gap.
 */
export function buildPool<C extends Candidate>(
  candidates: C[],
  rules: BuildRules,
  random: () => number = Math.random,
): BuildResult<C> {
  validateBuildRules(rules);
  const eligible = candidates.filter((c) => c.value >= rules.minValue && c.value <= rules.maxValue);
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
  const picked = shuffled.slice(0, rules.count);
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
    const j = closest(cents(out.value) + gap);
    const into = pool[j];
    const newGap = gap - (cents(into.value) - cents(out.value));
    if (Math.abs(newGap) >= Math.abs(gap)) continue;
    picked[i] = into;
    pool.splice(j, 1);
    pool.splice(lowerBound(cents(out.value)), 0, out);
    total += cents(into.value) - cents(out.value);
  }

  picked.sort((a, b) => b.value - a.value);
  return { cards: picked, total: total / 100, average: total / 100 / rules.count };
}
