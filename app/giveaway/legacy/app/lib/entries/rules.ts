import { z } from "zod";

// Purchase-entry rules for a campaign. Stored as JSON on Campaign.purchaseRules.
// Final score = (base + bundle + product points) x period multiplier x AOV booster multiplier.

const dateRange = z
  .object({
    start: z.coerce.date().optional(),
    end: z.coerce.date().optional(),
  })
  .optional();

const productTarget = z.object({
  productIds: z.array(z.string()).default([]),
  variantIds: z.array(z.string()).default([]),
});

export const purchaseRulesSchema = z.object({
  enabled: z.boolean().default(true),
  // Create an entrant from a paid order when the buyer hasn't signed up yet.
  autoSignupFromOrders: z.boolean().default(true),
  orderSource: z.enum(["all", "online", "pos", "online_pos"]).default("all"),
  minOrderValue: z.number().nonnegative().default(0),
  dateRange,
  base: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("none") }),
      z.object({
        mode: z.literal("fixed"),
        entries: z.number().int().nonnegative(),
      }),
      z.object({
        mode: z.literal("per_amount"),
        entries: z.number().int().nonnegative(),
        amount: z.number().positive(),
        basis: z.enum(["subtotal", "total"]).default("subtotal"),
      }),
    ])
    .default({ mode: "per_amount", entries: 1, amount: 1, basis: "subtotal" }),
  bundles: z
    .array(
      z.object({
        name: z.string(),
        entries: z.number().int().nonnegative(),
        groups: z
          .array(
            productTarget.extend({ quantity: z.number().int().positive() }),
          )
          .min(1),
        excludeFromOrderTotal: z.boolean().default(false),
      }),
    )
    .max(10)
    .default([]),
  productRules: z
    .array(
      productTarget.extend({
        name: z.string(),
        mode: z.enum(["per_unit", "per_amount"]),
        entries: z.number().int().nonnegative(),
        amount: z.number().positive().default(1),
        dateRange,
        bonusThreshold: z.number().positive().optional(),
        bonusEntries: z.number().int().nonnegative().optional(),
        skipIfBundleMatched: z.boolean().default(true),
      }),
    )
    .max(15)
    .default([]),
  aovBoosters: z
    .array(
      productTarget.extend({
        name: z.string(),
        multiplier: z.number().positive(),
        excludeFromOrderTotal: z.boolean().default(false),
      }),
    )
    .default([]),
  periodMultipliers: z
    .array(
      z.object({
        start: z.coerce.date(),
        end: z.coerce.date(),
        multiplier: z.number().positive(),
      }),
    )
    .default([]),
});

export type PurchaseRules = z.infer<typeof purchaseRulesSchema>;

export interface OrderLine {
  productId: string;
  variantId: string;
  quantity: number;
  unitPrice: number;
}

export interface ScorableOrder {
  createdAt: Date;
  sourceName: string; // Shopify order.sourceName: "web", "pos", "shopify_draft_order", ...
  subtotal: number;
  total: number;
  giftCardAmount: number;
  lines: OrderLine[];
}

export interface ScoreBreakdown {
  entries: number;
  valid: boolean;
  reason?: string;
  base: number;
  bundles: { name: string; times: number; entries: number }[];
  products: { name: string; entries: number }[];
  periodMultiplier: number;
  aovMultiplier: number;
}

const matches = (
  t: { productIds: string[]; variantIds: string[] },
  l: OrderLine,
) => t.productIds.includes(l.productId) || t.variantIds.includes(l.variantId);

const inRange = (d: Date, r?: { start?: Date; end?: Date }) =>
  !r || ((!r.start || d >= r.start) && (!r.end || d <= r.end));

function sourceAllowed(rule: PurchaseRules["orderSource"], source: string) {
  const isPos = source === "pos";
  if (rule === "all") return true;
  if (rule === "pos") return isPos;
  if (rule === "online") return source === "web";
  return isPos || source === "web";
}

export function scoreOrder(
  rules: PurchaseRules,
  order: ScorableOrder,
): ScoreBreakdown {
  const empty: ScoreBreakdown = {
    entries: 0,
    valid: false,
    base: 0,
    bundles: [],
    products: [],
    periodMultiplier: 1,
    aovMultiplier: 1,
  };
  if (!rules.enabled) return { ...empty, reason: "purchase entries disabled" };
  if (!sourceAllowed(rules.orderSource, order.sourceName)) {
    return {
      ...empty,
      reason: `order source "${order.sourceName}" not allowed`,
    };
  }

  // Remaining quantity per line, shared across bundles (highest reward first).
  const remaining = order.lines.map((l) => l.quantity);
  const bundleUsed = order.lines.map(() => 0);
  let excludedValue = 0;
  const bundles: ScoreBreakdown["bundles"] = [];

  for (const bundle of [...rules.bundles].sort(
    (a, b) => b.entries - a.entries,
  )) {
    const times = Math.min(
      ...bundle.groups.map((g) => {
        const qty = order.lines.reduce(
          (s, l, i) => (matches(g, l) ? s + remaining[i] : s),
          0,
        );
        return Math.floor(qty / g.quantity);
      }),
    );
    if (times <= 0) continue;
    for (const g of bundle.groups) {
      let need = g.quantity * times;
      order.lines.forEach((l, i) => {
        if (need <= 0 || !matches(g, l)) return;
        const take = Math.min(need, remaining[i]);
        remaining[i] -= take;
        bundleUsed[i] += take;
        need -= take;
        if (bundle.excludeFromOrderTotal) excludedValue += take * l.unitPrice;
      });
    }
    bundles.push({ name: bundle.name, times, entries: times * bundle.entries });
  }

  let aovMultiplier = 0;
  for (const booster of rules.aovBoosters) {
    const qty = order.lines.reduce(
      (s, l) => (matches(booster, l) ? s + l.quantity : s),
      0,
    );
    if (qty <= 0) continue;
    // Boosters add together (and count quantity) rather than compounding.
    aovMultiplier += booster.multiplier * qty;
    if (booster.excludeFromOrderTotal) {
      excludedValue += order.lines.reduce(
        (s, l) => (matches(booster, l) ? s + l.quantity * l.unitPrice : s),
        0,
      );
    }
  }
  if (aovMultiplier === 0) aovMultiplier = 1;

  const products: ScoreBreakdown["products"] = [];
  for (const rule of rules.productRules) {
    if (!inRange(order.createdAt, rule.dateRange)) continue;
    let units = 0;
    let spend = 0;
    order.lines.forEach((l, i) => {
      if (!matches(rule, l)) return;
      const q = rule.skipIfBundleMatched
        ? l.quantity - bundleUsed[i]
        : l.quantity;
      units += q;
      spend += q * l.unitPrice;
    });
    if (units <= 0) continue;
    let entries =
      rule.mode === "per_unit"
        ? units * rule.entries
        : Math.floor(spend / rule.amount) * rule.entries;
    if (
      rule.bonusThreshold &&
      rule.bonusEntries &&
      spend >= rule.bonusThreshold
    ) {
      entries += rule.bonusEntries;
    }
    products.push({ name: rule.name, entries });
  }

  // Base points: limited by date range and minimum order value only.
  let base = 0;
  const baseEligible =
    inRange(order.createdAt, rules.dateRange) &&
    order.subtotal >= rules.minOrderValue;
  if (baseEligible && rules.base.mode !== "none") {
    if (rules.base.mode === "fixed") {
      base = rules.base.entries;
    } else {
      const raw = rules.base.basis === "total" ? order.total : order.subtotal;
      const value = Math.max(0, raw - order.giftCardAmount - excludedValue);
      base = Math.floor(value / rules.base.amount) * rules.base.entries;
    }
  }

  // Overlapping periods don't stack: the highest applies.
  const periodMultiplier = rules.periodMultipliers
    .filter((p) => order.createdAt >= p.start && order.createdAt <= p.end)
    .reduce((m, p) => Math.max(m, p.multiplier), 1);

  const raw =
    base +
    bundles.reduce((s, b) => s + b.entries, 0) +
    products.reduce((s, p) => s + p.entries, 0);
  const entries = Math.floor(raw * periodMultiplier * aovMultiplier);

  return {
    entries,
    valid: true,
    base,
    bundles,
    products,
    periodMultiplier,
    aovMultiplier,
  };
}
