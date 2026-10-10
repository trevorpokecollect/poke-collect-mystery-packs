import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { gql } from "./orders.server";

/** The shop's primary storefront URL, e.g. https://poke-collect.com (a dev store's is its myshopify domain). */
export async function storefrontBase(admin: AdminApiContext, shop: string) {
  try {
    const data = await gql(admin, `#graphql
      query PackStorefront { shop { primaryDomain { url } } }`);
    const url: string | undefined = data.shop?.primaryDomain?.url;
    if (url) return url.replace(/\/$/, "");
  } catch (error) {
    console.error(`Could not read primary domain for ${shop}`, error);
  }
  return `https://${shop}`;
}

/** Public URL of the My Packs page, e.g. https://poke-collect.com/apps/packs */
export function packsPageUrl(base: string, openToken?: string) {
  return `${base}/apps/packs${openToken ? `?k=${encodeURIComponent(openToken)}` : ""}`;
}
