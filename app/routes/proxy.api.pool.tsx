import type { LoaderFunctionArgs } from "react-router";
import { oddsFromQuery } from "../lib/pool-page.server";
import { json, proxyContext } from "../lib/proxy.server";

// Odds for the pack on a product page: /apps/packs/api/pool?product=<id> (or ?series=<handle>).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await proxyContext(request);
  const odds = await oddsFromQuery(shop, new URL(request.url));
  return odds ? json(odds) : json({ error: "No mystery pack series for this product." }, 404);
};
