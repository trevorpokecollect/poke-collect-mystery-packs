import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { gql } from "./orders.server";

interface ProductNode {
  id: string;
  title: string;
  handle: string;
  status: string;
  imageUrl: string | null;
}

// Pack products barely change, and My Packs asks for the same few on every visit, so their details
// are kept for a few minutes instead of costing a Shopify call each time.
const TTL = 5 * 60 * 1000;
const cache = new Map<string, { at: number; node: Promise<ProductNode | null> }>();

async function productNodes(admin: AdminApiContext, productIds: string[]) {
  const now = Date.now();
  const missing = productIds.filter((id) => {
    const hit = cache.get(id);
    return !hit || now - hit.at > TTL;
  });
  if (missing.length) {
    const fetched = gql(
      admin,
      `#graphql
        query PackProducts($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product { id title handle status featuredMedia { preview { image { url } } } }
          }
        }`,
      { ids: missing },
    ).then((data) => {
      const byId = new Map<string, ProductNode>();
      for (const node of data.nodes ?? []) {
        if (!node?.id) continue;
        byId.set(node.id, {
          id: node.id,
          title: node.title,
          handle: node.handle,
          status: node.status,
          imageUrl: node.featuredMedia?.preview?.image?.url ?? null,
        });
      }
      return byId;
    });
    for (const id of missing) {
      const node = fetched.then((byId) => byId.get(id) ?? null);
      // A failed lookup isn't remembered, so the next visit tries again.
      node.catch(() => cache.delete(id));
      cache.set(id, { at: now, node });
    }
  }
  const nodes = await Promise.all(productIds.map((id) => cache.get(id)!.node));
  return nodes.filter((n): n is ProductNode => !!n);
}

/** Featured image of each pack product, so unopened packs show the real pack artwork. */
export async function packImages(admin: AdminApiContext | undefined, productIds: string[]) {
  const images = new Map<string, string>();
  if (!admin || productIds.length === 0) return images;
  try {
    for (const node of await productNodes(admin, productIds)) {
      if (node.imageUrl) images.set(node.id, node.imageUrl);
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
    for (const node of await productNodes(admin, productIds)) {
      if (node.status !== "ACTIVE") continue;
      products.set(node.id, { title: node.title, handle: node.handle, imageUrl: node.imageUrl });
    }
  } catch (error) {
    console.error("Could not load pack products", error);
  }
  return products;
}
