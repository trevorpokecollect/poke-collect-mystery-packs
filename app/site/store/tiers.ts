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

