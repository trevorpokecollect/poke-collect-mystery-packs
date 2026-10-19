// Vault Market checkout lines with the card's picture. A custom draft-order line can't carry an
// image, so each purchase gets its own variant (with the card image) on one hidden product,
// "Vault Card", which is never published to a sales channel and doesn't track inventory or ship.
// The variant is deleted once the sale is paid or the checkout lapses.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { gql } from "./orders.server";

export const VAULT_CARD_HANDLE = "vault-market-card";
export const VAULT_CARD_TYPE = "Vault Market Card";

const productIds = new Map<string, string>();

/** The hidden "Vault Card" product, created the first time it's needed. */
export async function vaultCardProduct(admin: AdminApiContext, shop: string) {
  const cached = productIds.get(shop);
  if (cached) return cached;
  const found = await gql(admin, `#graphql
    query VaultCardProduct($handle: String!) { productByHandle(handle: $handle) { id } }`, { handle: VAULT_CARD_HANDLE });
  let id = found.productByHandle?.id as string | undefined;
  if (!id) {
    const created = await gql(admin, `#graphql
      mutation VaultCardProductCreate($product: ProductCreateInput!) {
        productCreate(product: $product) { product { id } userErrors { field message } }
      }`, {
      product: {
        title: "Vault Card",
        handle: VAULT_CARD_HANDLE,
        productType: VAULT_CARD_TYPE,
        vendor: "Poke-Collect",
        status: "ACTIVE",
        descriptionHtml: "<p>A card bought from another collector in Vault Market. It moves to the buyer's vault; nothing ships. Used by the Mystery Packs app only.</p>",
        productOptions: [{ name: "Card", values: [{ name: "Vault Card" }] }],
      },
    });
    const errors = created.productCreate.userErrors as { message: string }[];
    if (errors.length) throw new Error(`Vault Card product: ${errors.map((e) => e.message).join("; ")}`);
    id = created.productCreate.product.id as string;
  }
  productIds.set(shop, id);
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
export async function deleteCheckoutVariant(admin: AdminApiContext, shop: string, variantId: string | null | undefined) {
  if (!variantId) return;
  try {
    const productId = await vaultCardProduct(admin, shop);
    const found = await gql(admin, `#graphql
      query VaultCardVariantMedia($id: ID!) { productVariant(id: $id) { id media(first: 5) { nodes { id } } } }`, { id: variantId });
    if (!found.productVariant) return;
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
