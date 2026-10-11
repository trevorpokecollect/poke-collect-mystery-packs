import db from "../db.server";
import { seriesHandleForProduct, seriesOdds } from "./pool.server";

/** Finds the series for ?series=<handle> or ?product=<numeric or gid product id>. */
export async function oddsFromQuery(shop: string, url: URL) {
  let handle = url.searchParams.get("series")?.trim() || null;
  const product = url.searchParams.get("product")?.trim();
  if (!handle && product) {
    const gid = product.startsWith("gid://") ? product : `gid://shopify/Product/${product.replace(/\D/g, "")}`;
    handle = await seriesHandleForProduct(db, shop, gid);
  }
  return handle ? seriesOdds(db, shop, handle) : null;
}

/**
 * A random card from what's still in the pool, for the product page's demo opening.
 * Every remaining copy is equally likely, so the demo matches the real odds. It is drawn with
 * Math.random, independent of the committed shuffle, so it says nothing about the next real pack.
 */
export async function sampleFromQuery(shop: string, url: URL) {
  let handle = url.searchParams.get("series")?.trim() || null;
  const product = url.searchParams.get("product")?.trim();
  if (!handle && product) {
    const gid = product.startsWith("gid://") ? product : `gid://shopify/Product/${product.replace(/\D/g, "")}`;
    handle = await seriesHandleForProduct(db, shop, gid);
  }
  if (!handle) return null;
  const series = await db.series.findFirst({ where: { shop, handle, status: "LIVE" } });
  if (!series) return null;
  const left = { seriesId: series.id, claimed: false, voided: false };
  const count = await db.slot.count({ where: left });
  if (count === 0) return null;
  const slot = await db.slot.findFirst({
    where: left,
    orderBy: { id: "asc" },
    skip: Math.floor(Math.random() * count),
    include: { card: true },
  });
  if (!slot) return null;
  return { series, card: { title: slot.card.title, tier: slot.card.tier, imageUrl: slot.card.imageUrl } };
}
