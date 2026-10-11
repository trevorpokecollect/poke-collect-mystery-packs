import type { LoaderFunctionArgs } from "react-router";
import { packImages, packProducts } from "../lib/pack-art.server";
import { sampleFromQuery } from "../lib/pool-page.server";
import { json, proxyContext } from "../lib/proxy.server";

// Demo opening for shoppers: /apps/packs/api/sample?product=<id> returns a random card from the
// cards still in the pool. Nothing is claimed or reserved; it's only for the animation.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, admin } = await proxyContext(request);
  const sample = await sampleFromQuery(shop, new URL(request.url));
  if (!sample) return json({ error: "This pack has no cards left to demo." }, 404);
  const { series, card } = sample;
  const [art, products] = await Promise.all([
    packImages(admin, [series.packProductId]),
    packProducts(admin, [series.packProductId]),
  ]);
  const product = products.get(series.packProductId);
  return json({
    series: series.title,
    packImageUrl: art.get(series.packProductId) ?? null,
    productUrl: product ? `/products/${product.handle}` : "/",
    card,
  });
};
