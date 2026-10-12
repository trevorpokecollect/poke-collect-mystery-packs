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

export interface PackProduct {
  title: string;
  handle: string;
  imageUrl: string | null;
}

/** Storefront details of active pack products, for the "Open More Packs?" shelf. */
export async function packProducts(admin: AdminApiContext | undefined, productIds: string[]) {
  const products = new Map<string, PackProduct>();
  if (!admin || productIds.length === 0) return products;
  try {
    const data = await gql(
      admin,
      `#graphql
        query PackProducts($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product { id title handle status featuredMedia { preview { image { url } } } }
          }
        }`,
      { ids: productIds },
    );
    for (const node of data.nodes ?? []) {
      if (!node?.id || node.status !== "ACTIVE") continue;
      products.set(node.id, {
        title: node.title,
        handle: node.handle,
        imageUrl: node.featuredMedia?.preview?.image?.url ?? null,
      });
    }
  } catch (error) {
    console.error("Could not load pack products", error);
  }
  return products;
}
