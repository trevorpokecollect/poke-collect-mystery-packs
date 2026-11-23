import type { PurchaseRules } from "./entries/rules";

// Wording for the widget's "Shop & earn" row, from the giveaway's purchase rules.

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const entriesWord = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;

/** "50 entries for every $10 you spend"; null when purchases earn nothing on their own. */
export function purchaseRateText(rules: PurchaseRules) {
  if (!rules.enabled) return null;
  const min =
    rules.minOrderValue > 0
      ? ` on orders of ${money(rules.minOrderValue)}+`
      : "";
  const b = rules.base;
  if (b.mode === "per_amount" && b.entries > 0)
    return `${entriesWord(b.entries)} for every ${money(b.amount)} you spend${min}`;
  if (b.mode === "fixed" && b.entries > 0)
    return `${entriesWord(b.entries)} for every order${min}`;
  if (rules.productRules.length || rules.bundles.length)
    return `Earn entries on selected products${min}`;
  return null;
}

// Used when the Shop now link isn't a real collection (e.g. /collections/all).
export const FALLBACK_COLLECTION = "popular-picks";

/** The collection handle behind a Shop now link, or the fallback. */
export function feedCollection(url: string) {
  const m = /\/collections\/([a-z0-9][a-z0-9-]*)\/?(?:[?#].*)?$/i.exec(url);
  return m && m[1] !== "all" ? m[1] : FALLBACK_COLLECTION;
}
