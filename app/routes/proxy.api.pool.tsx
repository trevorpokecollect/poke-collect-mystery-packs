import type { LoaderFunctionArgs } from "react-router";
import { oddsFromQuery } from "../lib/pool-page.server";
import { json, proxyContext } from "../lib/proxy.server";

// Odds for the pack on a product page: /apps/packs/api/pool?product=<id> (or ?series=<handle>).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await proxyContext(request);
  const odds = await oddsFromQuery(shop, new URL(request.url));
  // Lets the product page and home page load the opener files that match this deploy.
  const openerVersion = (process.env.RAILWAY_DEPLOYMENT_ID || process.env.RAILWAY_GIT_COMMIT_SHA || "dev").slice(0, 12);
  return odds ? json({ ...odds, openerVersion }) : json({ error: "No mystery pack series for this product." }, 404);
};
