// Vault Market checkout lines with the card's picture. A custom draft-order line can't carry an
// image, so each purchase gets its own variant (with the card image) on one hidden product,
// "Vault Card", which is never published to a sales channel and doesn't track inventory or ship.
// A paid sale keeps its variant so the order shows the card picture in the admin; a lapsed checkout's
// variant is deleted. A product holds up to 2,048 variants, so a new "Vault Card" product is started
// once the current one is nearly full.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { gql } from "./orders.server";

export const VAULT_CARD_HANDLE = "vault-market-card";
export const VAULT_CARD_TYPE = "Vault Market Card";

const VARIANT_LIMIT = 1900;
const productIds = new Map<string, { id: string; at: number }>();

async function createVaultCardProduct(admin: AdminApiContext, handle: string) {
  const created = await gql(admin, `#graphql
    mutation VaultCardProductCreate($product: ProductCreateInput!) {
      productCreate(product: $product) { product { id } userErrors { field message } }
    }`, {
    product: {
      title: "Vault Card",
      handle,
      productType: VAULT_CARD_TYPE,
      vendor: "Poke-Collect",
      status: "ACTIVE",
      descriptionHtml: "<p>A card bought from another collector in Vault Market. It moves to the buyer's vault; nothing ships. Used by the Mystery Packs app only.</p>",
      productOptions: [{ name: "Card", values: [{ name: "Vault Card" }] }],
    },
  });
  const errors = created.productCreate.userErrors as { message: string }[];
  if (errors.length) throw new Error(`Vault Card product: ${errors.map((e) => e.message).join("; ")}`);
  return created.productCreate.product.id as string;
}

/** The hidden "Vault Card" product with room for more variants, created when needed. */
export async function vaultCardProduct(admin: AdminApiContext, shop: string) {
  const cached = productIds.get(shop);
  if (cached && Date.now() - cached.at < 3_600_000) return cached.id;
  const found = await gql(admin, `#graphql
    query VaultCardProducts($q: String!) {
      products(first: 20, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { id handle variantsCount { count } } }
    }`, { q: `product_type:'${VAULT_CARD_TYPE}'` });
  const products = (found.products?.nodes ?? []) as { id: string; handle: string; variantsCount: { count: number } }[];
  let id = products.find((p) => p.variantsCount.count < VARIANT_LIMIT)?.id;
  if (!id) id = await createVaultCardProduct(admin, products.length ? `${VAULT_CARD_HANDLE}-${products.length + 1}` : VAULT_CARD_HANDLE);
  productIds.set(shop, { id, at: Date.now() });
  return id;
}

/** A one-off variant for this purchase: the card's title, picture and price. */
export async function createCheckoutVariant(
  admin: AdminApiContext,
  shop: string,
  { listingId, title, price, imageUrl }: { listingId: string; title: string; price: number; imageUrl: string | null },
) {
  const productId = await vaultCardProduct(admin, shop);
  const attempt = async (name: string) =>
    gql(admin, `#graphql
      mutation VaultCardVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $media: [CreateMediaInput!]) {
        productVariantsBulkCreate(productId: $productId, variants: $variants, media: $media) {
          productVariants { id }
          userErrors { field message }
        }
      }`, {
      productId,
      media: imageUrl ? [{ originalSource: imageUrl, mediaContentType: "IMAGE", alt: title }] : null,
      variants: [
        {
          optionValues: [{ optionName: "Card", name }],
          price: price.toFixed(2),
          taxable: true,
          inventoryPolicy: "CONTINUE",
          inventoryItem: { tracked: false, requiresShipping: false, sku: `VM-${listingId}` },
          ...(imageUrl ? { mediaSrc: [imageUrl] } : {}),
        },
      ],
    });
  let data = await attempt(title.slice(0, 240));
  let errors = data.productVariantsBulkCreate.userErrors as { message: string }[];
  // Two checkouts for the same card name at once: make this one's name unique.
  if (errors.length) {
    data = await attempt(`${title.slice(0, 220)} · ${listingId.slice(-6)}`);
    errors = data.productVariantsBulkCreate.userErrors as { message: string }[];
  }
  if (errors.length) throw new Error(`Vault Card variant: ${errors.map((e) => e.message).join("; ")}`);
  return data.productVariantsBulkCreate.productVariants[0].id as string;
}

/** Removes a purchase's variant and its picture. Never throws. */
export async function deleteCheckoutVariant(admin: AdminApiContext, _shop: string, variantId: string | null | undefined) {
  if (!variantId) return;
  try {
    const found = await gql(admin, `#graphql
      query VaultCardVariantMedia($id: ID!) { productVariant(id: $id) { id product { id } media(first: 5) { nodes { id } } } }`, { id: variantId });
    if (!found.productVariant) return;
    const productId = found.productVariant.product.id as string;
    const mediaIds = (found.productVariant.media?.nodes ?? []).map((m: { id: string }) => m.id);
    await gql(admin, `#graphql
      mutation VaultCardVariantDelete($productId: ID!, $variantsIds: [ID!]!) {
        productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) { userErrors { field message } }
      }`, { productId, variantsIds: [variantId] });
    if (mediaIds.length) {
      await gql(admin, `#graphql
        mutation VaultCardMediaDelete($productId: ID!, $mediaIds: [ID!]!) {
          productDeleteMedia(productId: $productId, mediaIds: $mediaIds) { deletedMediaIds mediaUserErrors { field message } }
        }`, { productId, mediaIds });
    }
  } catch (error) {
    console.error(`Removing Vault Card variant ${variantId} failed`, error);
  }
}
