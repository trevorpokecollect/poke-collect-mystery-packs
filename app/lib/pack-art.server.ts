import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { gql } from "./orders.server";

/** Featured image of each pack product, so unopened packs show the real pack artwork. */
export async function packImages(admin: AdminApiContext | undefined, productIds: string[]) {
  const images = new Map<string, string>();
  if (!admin || productIds.length === 0) return images;
  try {
    const data = await gql(
      admin,
      `#graphql
        query PackArt($ids: [ID!]!) {
          nodes(ids: $ids) { ... on Product { id featuredMedia { preview { image { url } } } } }
        }`,
      { ids: productIds },
    );
    for (const node of data.nodes ?? []) {
      const url = node?.featuredMedia?.preview?.image?.url;
      if (node?.id && url) images.set(node.id, url);
    }
  } catch (error) {
    console.error("Could not load pack artwork", error);
  }
  return images;
}
