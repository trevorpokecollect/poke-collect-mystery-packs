import { scoreOrder, type PurchaseRules, type ScorableOrder } from "./rules";

// "Earn X entries" estimates for product pages, the cart and the thank-you page.
// Runs the same scoring engine as the order webhook on a pretend web order placed now.

export interface EstimateLine {
  /** Numeric id or gid. */
  productId?: string | number | null;
  variantId?: string | number | null;
  quantity: number;
  /** Unit price in the shop currency's minor unit (cents), as Liquid and /cart.js give it. */
  price: number;
  giftCard?: boolean;
}

export const toGid = (type: string, id: string | number | null | undefined) => {
  if (id === null || id === undefined || id === "") return "";
  const s = String(id);
  return s.startsWith("gid://") ? s : `gid://shopify/${type}/${s}`;
};

/** Accepts any of our request shapes and drops anything malformed. */
export function parseEstimateLines(raw: unknown): EstimateLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 100).flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    const o = r as Record<string, unknown>;
    const quantity = Math.floor(Number(o.quantity ?? 1));
    const price = Number(o.price);
    if (!(quantity > 0) || !Number.isFinite(price) || price < 0) return [];
    const id = (v: unknown) =>
      typeof v === "string" || typeof v === "number" ? v : null;
    return [
      {
        productId: id(o.productId ?? o.product_id),
        variantId: id(o.variantId ?? o.variant_id),
        quantity: Math.min(quantity, 999),
        price,
        giftCard: o.giftCard === true || o.gift_card === true,
      },
    ];
  });
}

export function estimateOrder(
  lines: EstimateLine[],
  now = new Date(),
): ScorableOrder {
  // Gift cards never earn entries.
  const paid = lines.filter((l) => !l.giftCard && l.quantity > 0);
  const subtotal = paid.reduce((s, l) => s + (l.price / 100) * l.quantity, 0);
  return {
    createdAt: now,
    sourceName: "web",
    subtotal,
    total: subtotal,
    giftCardAmount: 0,
    lines: paid.map((l) => ({
      productId: toGid("Product", l.productId),
      variantId: toGid("ProductVariant", l.variantId),
      quantity: l.quantity,
      unitPrice: l.price / 100,
    })),
  };
}

export function estimateEntries(
  rules: PurchaseRules,
  lines: EstimateLine[],
  now = new Date(),
) {
  if (!lines.length) return 0;
  return scoreOrder(rules, estimateOrder(lines, now)).entries;
}
