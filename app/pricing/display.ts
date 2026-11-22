import type { Draft, PriceCard } from "./calculator.mjs";
export const usd = (n: number | null) =>
  n == null
    ? "Pending"
    : (n / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
export const bits = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
export const percent = (n: number | null, base: number) =>
  n == null || !base
    ? "—"
    : ((100 * n) / base).toLocaleString("en-US", { maximumFractionDigits: 2 }) +
      "%";
export const buying = (c: PriceCard) => Boolean(c.cash && c.credit && c.retail);
export type Edit = (change: (draft: Draft) => void) => void;
