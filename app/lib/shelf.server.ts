import type { availableSeries } from "./pool.server";
import type { PackProduct } from "./pack-art.server";

/** Packs on sale right now, for the "Open More Packs?" shelf on My Packs. */
export function packShelf(live: Awaited<ReturnType<typeof availableSeries>>, products: Map<string, PackProduct>) {
  return live.flatMap(({ series, packsLeft }) => {
    const product = products.get(series.packProductId);
    if (!product) return [];
    return [{
      series: series.title,
      title: product.title,
      url: `/products/${product.handle}`,
      // Checkout link for one pack, straight past the cart.
      buyUrl: `/cart/${series.packVariantId.split("/").pop()}:1`,
      imageUrl: product.imageUrl,
      price: series.packPrice.toString(),
      packsLeft,
    }];
  });
}
