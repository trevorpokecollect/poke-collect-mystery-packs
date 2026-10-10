/** Public storefront URL of the My Packs page, e.g. https://poke-collect.com/apps/packs */
export function packsPageUrl(shop: string, openToken?: string) {
  const base = (process.env.STOREFRONT_URL || `https://${shop}`).replace(/\/$/, "");
  return `${base}/apps/packs${openToken ? `?k=${encodeURIComponent(openToken)}` : ""}`;
}
