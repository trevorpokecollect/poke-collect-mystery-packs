// Per-site branding (2026-11-20, cardbit.com): the same code runs poke-collect.com's packs and a second, separate
// install for another store, each its own deployment. Everything a customer reads that names the store comes from
// here. Defaults are Poke-Collect's, so the existing deployment needs no new variables.
export interface Brand {
  /** Store name in customer copy: "Back To Poke-Collect", "your Poke-Collect vault". */
  name: string;
  supportEmail: string;
  /** Favicon for the standalone Vault Market pages. */
  faviconUrl: string;
  /** Handle of the pack product the "Shop Mystery Packs" buttons open. */
  packProductHandle: string;
  /** Public site, for outbound User-Agents. */
  siteUrl: string;
}

export function brand(env: Record<string, string | undefined> = process.env): Brand {
  return {
    name: env.BRAND_NAME?.trim() || "Poke-Collect",
    supportEmail: env.SUPPORT_EMAIL?.trim() || "support@poke-collect.com",
    faviconUrl: env.BRAND_FAVICON_URL?.trim() || "https://poke-collect.com/cdn/shop/files/Logo_Inverted_f6f1059b-c34e-41fe-a1fb-019ee80646f3.png?v=1722967747&crop=center",
    packProductHandle: env.PACK_PRODUCT_HANDLE?.trim() || "poke-collect-mystery-pack",
    siteUrl: env.BRAND_SITE_URL?.trim() || "https://poke-collect.com",
  };
}

/** data-brand / data-support attributes for the storefront scripts (opener.js, market.js). Values are HTML-escaped. */
export function brandAttrs(b: Brand = brand()): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return ` data-brand="${esc(b.name)}" data-support="${esc(b.supportEmail)}"`;
}
