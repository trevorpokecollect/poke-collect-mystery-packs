// Shared brand tokens + escaping for server-rendered HTML (emails, packing slips).
export const BRAND = {
  cobalt: "#4057F5",
  apricot: "#FFB65C",
  navy: "#17213B",
  ivory: "#FAF8F3",
  ink: "#1E2433",
  muted: "#5B6478",
  line: "#E6E1D6",
  heading: "'Outfit', 'Atkinson Hyperlegible Next', Arial, sans-serif",
  body: "'Atkinson Hyperlegible Next', 'Atkinson Hyperlegible', Arial, sans-serif",
};

/** Public base URL of the site (links in emails). */
export function siteUrl(env: NodeJS.ProcessEnv = process.env) {
  return (env.CARDBIT_SITE_URL || "https://cardbit.com").replace(/\/+$/, "");
}

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const bits = (n: number) => `${Math.round(n).toLocaleString("en-US")} Cardbits`;
export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
