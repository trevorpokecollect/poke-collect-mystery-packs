/**
 * Daily Spinner rules. Free once per Cardbit day. Higher levels use better tables, and a check-in
 * streak raises the chance of a real card. Prize features stay off until official rules, a free
 * entry method and Trevor's approval exist.
 */
export type Slice = { kind: "card" | "sparks" | "xp"; amount?: number; weight: number };
export type SpinTable = Record<string, Slice[]>;

/** Weights are relative. Card slices draw the next committed copy from that tier's Daily Spin pool. */
export const DEFAULT_SPIN_TABLE: SpinTable = {
  basic: [
    { kind: "card", weight: 20 },
    { kind: "sparks", amount: 50, weight: 150 },
    { kind: "sparks", amount: 25, weight: 300 },
    { kind: "xp", amount: 25, weight: 530 },
  ],
  bronze: [
    { kind: "card", weight: 30 },
    { kind: "sparks", amount: 75, weight: 150 },
    { kind: "sparks", amount: 35, weight: 300 },
    { kind: "xp", amount: 35, weight: 520 },
  ],
  silver: [
    { kind: "card", weight: 40 },
    { kind: "sparks", amount: 100, weight: 150 },
    { kind: "sparks", amount: 50, weight: 300 },
    { kind: "xp", amount: 50, weight: 510 },
  ],
  gold: [
    { kind: "card", weight: 80 },
    { kind: "sparks", amount: 150, weight: 170 },
    { kind: "sparks", amount: 75, weight: 300 },
    { kind: "xp", amount: 75, weight: 450 },
  ],
  cobalt: [
    { kind: "card", weight: 150 },
    { kind: "sparks", amount: 250, weight: 200 },
    { kind: "sparks", amount: 100, weight: 300 },
    { kind: "xp", amount: 100, weight: 350 },
  ],
  holo: [
    { kind: "card", weight: 220 },
    { kind: "sparks", amount: 400, weight: 200 },
    { kind: "sparks", amount: 150, weight: 280 },
    { kind: "xp", amount: 150, weight: 300 },
  ],
};

/** Each consecutive check-in day adds 10% to the card weight, up to 7 days (+70%). */
export const STREAK_CARD_BONUS = { perDay: 0.1, maxDays: 7 };

export function validTable(value: unknown): value is SpinTable {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (slices) =>
      Array.isArray(slices) &&
      slices.length > 0 &&
      slices.every(
        (s) =>
          s &&
          ["card", "sparks", "xp"].includes(s.kind) &&
          Number.isSafeInteger(s.weight) &&
          s.weight >= 0 &&
          (s.kind === "card" || (Number.isSafeInteger(s.amount) && s.amount > 0 && s.amount <= 10_000)),
      ) &&
      slices.some((s) => s.weight > 0) &&
      // A non-card slice is the fallback when the tier's Daily Spin pool is empty.
      slices.some((s) => s.kind !== "card"),
  );
}

export function weightedSlices(slices: Slice[], streak: number) {
  const days = Math.min(Math.max(0, Math.floor(streak)), STREAK_CARD_BONUS.maxDays);
  return slices.map((s) =>
    s.kind === "card" ? { ...s, weight: Math.round(s.weight * (1 + days * STREAK_CARD_BONUS.perDay)) } : s,
  );
}

/** Pick a slice with a uniform integer ticket in [0, total). */
export function pickSlice(slices: Slice[], ticket: number) {
  let t = ticket;
  for (const s of slices) {
    if (t < s.weight) return s;
    t -= s.weight;
  }
  return slices[slices.length - 1];
}
export const totalWeight = (slices: Slice[]) => slices.reduce((n, s) => n + s.weight, 0);

/** Odds shown to customers, as whole-number percentages of the current table. */
export function displayOdds(slices: Slice[]) {
  const total = totalWeight(slices);
  return slices.map((s) => ({ kind: s.kind, amount: s.amount ?? null, percent: total ? Math.round((s.weight / total) * 1000) / 10 : 0 }));
}
