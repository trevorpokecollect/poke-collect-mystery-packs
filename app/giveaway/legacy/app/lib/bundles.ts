// Daily prize bundles: one day's prize made of several products, or several of the same
// product ("3x"). Lined up in Upcoming Prizes (DailyQueueItem.bundle) and held on the prize
// (DailyPrize.items). Pure helpers; the reserving lives in daily.server.ts.

export interface BundlePart {
  productId: string;
  title: string;
  imageUrl: string | null;
  quantity: number;
}

/** One reserved line of a bundle prize (one variant, `quantity` units). */
export interface PrizeItem {
  productId: string;
  variantId: string;
  productHandle: string | null;
  title: string;
  imageUrl: string | null;
  value: number;
  inventoryItemId: string;
  locationId: string;
  reservedFrom: string;
  quantity: number;
}

export const MAX_BUNDLE_PARTS = 6;
export const MAX_PART_QUANTITY = 10;

/** Cleans what the editor sent: real product ids, whole quantities 1–10, same product merged. */
export function parseBundle(raw: unknown): BundlePart[] | null {
  if (!Array.isArray(raw)) return null;
  const parts: BundlePart[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const productId = typeof r?.productId === "string" ? r.productId : "";
    if (!productId.startsWith("gid://shopify/Product/")) continue;
    const q = Math.floor(Number(r.quantity));
    const quantity = Math.min(MAX_PART_QUANTITY, Math.max(1, q || 1));
    const same = parts.find((p) => p.productId === productId);
    if (same) {
      same.quantity = Math.min(MAX_PART_QUANTITY, same.quantity + quantity);
      continue;
    }
    parts.push({
      productId,
      title: String(r.title ?? "").slice(0, 200) || "Product",
      imageUrl: typeof r.imageUrl === "string" ? r.imageUrl : null,
      quantity,
    });
  }
  const total = parts.reduce((n, p) => n + p.quantity, 0);
  // A bundle is 2+ units in all; a single unit is just a normal queued product.
  if (!parts.length || parts.length > MAX_BUNDLE_PARTS || total < 2)
    return null;
  return parts;
}

const label = (p: { title: string; quantity: number }) =>
  p.quantity > 1 ? `${p.quantity}x ${p.title}` : p.title;

/** "3x Booster Pack", or "Elite Trainer Box + 2x Booster Pack". */
export const bundleTitle = (parts: { title: string; quantity: number }[]) =>
  parts.map(label).join(" + ");

export const bundleValue = (items: { value: number; quantity: number }[]) =>
  Math.round(items.reduce((n, i) => n + i.value * i.quantity, 0) * 100) / 100;

/** The stored items of a prize, or null for an ordinary single-product prize. */
export function prizeItems(raw: unknown): PrizeItem[] | null {
  return Array.isArray(raw) && raw.length ? (raw as PrizeItem[]) : null;
}

/** The storefront's view of a bundle: pictures and "3x" counts, never values. */
export function publicItems(
  items: {
    title: string;
    imageUrl: string | null;
    quantity: number;
    productHandle?: string | null;
  }[],
) {
  return items.map((i) => ({
    title: i.title,
    imageUrl: i.imageUrl,
    quantity: i.quantity,
    url: i.productHandle ? `/products/${i.productHandle}` : null,
  }));
}
