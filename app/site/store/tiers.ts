// Tier ladder for pack pools (pack pages, odds, pool contents, reveals). Never used for Shop Singles.
export type TierRule = { name: string; min: number };
/** Default ladder (Cardbits of card value; 100 = $1) until staff set per-pack rules. */
export const DEFAULT_TIERS: TierRule[] = [
  { name: "Common", min: 0 },
  { name: "Uncommon", min: 500 },
  { name: "Rare", min: 1500 },
  { name: "Epic", min: 5000 },
  { name: "Legendary", min: 15000 },
];
export function tierRules(raw: unknown): TierRule[] {
  if (!Array.isArray(raw)) return DEFAULT_TIERS;
  const rules = raw.filter((r): r is TierRule => typeof r?.name === "string" && Number.isFinite(r?.min)).sort((a, b) => a.min - b.min);
  return rules.length ? rules : DEFAULT_TIERS;
}
export function tierFor(valueBits: number | null, rules: TierRule[] = DEFAULT_TIERS): string | null {
  if (valueBits == null) return null;
  let tier: string | null = null;
  for (const r of rules) if (valueBits >= r.min) tier = r.name;
  return tier;
}


// ---------- Auto-scaling tiers (Trevor, Nov 25 2026) ----------
// Tiers come from each card's rank by value within its own pool, using a fixed mix (default pyramid
// 50/25/15/8/2). Cutoffs are recomputed at every published restock and once a day after price refreshes,
// and saved on the pack (tierRules) and the pool version, so odds and value ranges always match the pool.
export type TierMix = { name: string; pct: number }[]; // lowest tier first
export const DEFAULT_MIX: TierMix = [
  { name: "Common", pct: 50 },
  { name: "Uncommon", pct: 25 },
  { name: "Rare", pct: 15 },
  { name: "Epic", pct: 8 },
  { name: "Legendary", pct: 2 },
];
export function tierMix(raw: unknown): TierMix {
  if (!Array.isArray(raw)) return DEFAULT_MIX;
  const mix = raw.filter((r): r is { name: string; pct: number } => typeof r?.name === "string" && Number.isFinite(r?.pct) && r.pct >= 0);
  const total = mix.reduce((a, r) => a + r.pct, 0);
  return mix.length >= 2 && Math.abs(total - 100) < 0.01 ? mix : DEFAULT_MIX;
}

/**
 * Cutoffs (as a TierRule ladder) from the pool's card values. Walks down from the top tier taking its share
 * of the ranked cards; the cutoff is the value of the last card in that share, so cards with the same value
 * always land in the same (higher) tier. The top tier always gets at least one card unless `topMin` (a
 * minimum value for the top tier) rules it out. Tiers squeezed out by ties are left out.
 */
export function autoTierRules(values: readonly (number | null)[], mix: TierMix = DEFAULT_MIX, topMin: number | null = null) {
  const v = values.filter((x): x is number => x != null && x > 0).sort((a, b) => b - a);
  const n = v.length;
  const top = mix.length - 1;
  const rules: TierRule[] = [];
  let cum = 0;
  let prevMin = Infinity;
  let topShort = false;
  for (let i = top; i >= 1; i--) {
    let count = Math.round((n * mix[i].pct) / 100);
    if (i === top && n > 0) count = Math.max(1, count);
    cum += count;
    if (!n || cum === 0) continue;
    let min = v[Math.min(cum, n) - 1];
    if (i === top && topMin != null && min < topMin) {
      min = topMin;
      topShort = !v.some((x) => x >= topMin);
    }
    if (min >= prevMin || min <= 0) continue;
    rules.push({ name: mix[i].name, min });
    prevMin = min;
  }
  rules.push({ name: mix[0].name, min: 0 });
  return { rules: rules.reverse(), topShort, cards: n };
}
