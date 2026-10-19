import db from "../db.server";
import { seriesHandleForProduct, seriesOdds } from "./pool.server";

/** Finds the series for ?series=<handle> or ?product=<numeric or gid product id>. */
export async function oddsFromQuery(shop: string, url: URL, languages?: Parameters<typeof seriesOdds>[3]) {
  let handle = url.searchParams.get("series")?.trim() || null;
  const product = url.searchParams.get("product")?.trim();
  if (!handle && product) {
    const gid = product.startsWith("gid://") ? product : `gid://shopify/Product/${product.replace(/\D/g, "")}`;
    handle = await seriesHandleForProduct(db, shop, gid);
  }
  return handle ? seriesOdds(db, shop, handle, languages) : null;
}
