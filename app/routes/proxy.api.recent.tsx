import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { json, proxyContext } from "../lib/proxy.server";
import { latestTopTierPull, recentPulls } from "../lib/recent-pulls.server";

// Public pull feed for the storefront: /apps/packs/api/recent
//   ?product=<id>  only pulls from packs sold through that product (pack product page feed)
//   ?limit=<n>     how many recent pulls (default 12, max 30)
// Always includes `top`, the newest top-tier (Master) pull, for the home page pack section.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await proxyContext(request);
  const url = new URL(request.url);
  const raw = url.searchParams.get("product")?.trim();
  const productId = raw ? (raw.startsWith("gid://") ? raw : `gid://shopify/Product/${raw.replace(/\D/g, "")}`) : null;
  const limit = Number(url.searchParams.get("limit")) || undefined;
  const [pulls, top] = await Promise.all([recentPulls(db, shop, { productId, limit }), latestTopTierPull(db, shop)]);
  return json({ top, pulls });
};
