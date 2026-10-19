import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { gql } from "./orders.server";

export type CardLanguage = "english" | "japanese";

// A product's language never changes, so lookups are kept for the life of the process.
const known = new Map<string, CardLanguage>();

/** Japanese when the product carries StorePass's Language_Japanese tag or a Japanese product type. */
export function languageOf(product: { tags: string[]; productType?: string | null }): CardLanguage {
  const tagged = product.tags.some((t) => t.trim().toLowerCase() === "language_japanese");
  return tagged || /japanese/i.test(product.productType ?? "") ? "japanese" : "english";
}

/**
 * Card language by product id, so the opening shows the matching English or Japanese card back.
 * Unknown products (or no admin access) count as English.
 */
export async function cardLanguages(admin: AdminApiContext | undefined, productIds: string[]) {
  const ids = [...new Set(productIds)].filter((id) => id && !known.has(id));
  if (admin && ids.length) {
    try {
      for (let i = 0; i < ids.length; i += 250) {
        const data = await gql(
          admin,
          `#graphql
            query CardLanguages($ids: [ID!]!) {
              nodes(ids: $ids) { ... on Product { id tags productType } }
            }`,
          { ids: ids.slice(i, i + 250) },
        );
        for (const node of data.nodes ?? []) {
          if (node?.id) known.set(node.id, languageOf(node));
        }
      }
    } catch (error) {
      console.error("Could not load card languages", error);
    }
  }
  return (productId: string): CardLanguage => known.get(productId) ?? "english";
}
