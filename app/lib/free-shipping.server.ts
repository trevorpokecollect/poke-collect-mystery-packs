// "Free shipping on N+ mystery packs": an automatic shipping discount backed by the
// pack-free-shipping Shopify Function. Only mystery-pack items count toward N.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { gql } from "./orders.server";

const FUNCTION_HANDLE = "pack-free-shipping";
const CONFIG = { namespace: "$app", key: "function-configuration" };
// The discount's id is kept on the shop so the settings card can find it again.
const SHOP_KEY = { namespace: "$app", key: "pack_free_shipping_discount" };
export const PACK_PRODUCT_TYPE = "Mystery Pack";

export interface FreeShippingSettings {
  enabled: boolean;
  threshold: number;
}

const title = (threshold: number) => `Free shipping on ${threshold}+ Mystery Packs`;

export async function getFreeShipping(admin: AdminApiContext): Promise<FreeShippingSettings & { discountId: string | null }> {
  const data = await gql(
    admin,
    `#graphql
      query PackFreeShippingId($namespace: String!, $key: String!) {
        shop { id metafield(namespace: $namespace, key: $key) { value } }
      }`,
    SHOP_KEY,
  );
  const discountId: string | null = data.shop.metafield?.value ?? null;
  if (!discountId) return { enabled: false, threshold: 5, discountId: null };

  const found = await gql(
    admin,
    `#graphql
      query PackFreeShipping($id: ID!, $namespace: String!, $key: String!) {
        discountNode(id: $id) {
          id
          metafield(namespace: $namespace, key: $key) { jsonValue }
          discount { ... on DiscountAutomaticApp { status } }
        }
      }`,
    { id: discountId, ...CONFIG },
  );
  const node = found.discountNode;
  if (!node) return { enabled: false, threshold: 5, discountId: null };
  return {
    discountId,
    enabled: node.discount?.status === "ACTIVE",
    threshold: Number(node.metafield?.jsonValue?.threshold) || 5,
  };
}

export async function saveFreeShipping(admin: AdminApiContext, settings: FreeShippingSettings) {
  const threshold = Math.floor(settings.threshold);
  if (!(threshold >= 1 && threshold <= 100)) throw new Error("The pack count must be a whole number from 1 to 100.");
  const config = {
    ...CONFIG,
    type: "json",
    value: JSON.stringify({ threshold, productType: PACK_PRODUCT_TYPE }),
  };
  const current = await getFreeShipping(admin);

  if (!current.discountId) {
    if (!settings.enabled) return;
    const created = await gql(
      admin,
      `#graphql
        mutation PackFreeShippingCreate($discount: DiscountAutomaticAppInput!) {
          discountAutomaticAppCreate(automaticAppDiscount: $discount) {
            automaticAppDiscount { discountId }
            userErrors { field message }
          }
        }`,
      {
        discount: {
          title: title(threshold),
          functionHandle: FUNCTION_HANDLE,
          discountClasses: ["SHIPPING"],
          startsAt: new Date().toISOString(),
          // Stacks with product and order discounts (e.g. a sale on packs).
          combinesWith: { productDiscounts: true, orderDiscounts: true, shippingDiscounts: false },
          metafields: [config],
        },
      },
    );
    const discountId = created.discountAutomaticAppCreate.automaticAppDiscount.discountId;
    const shop = await gql(admin, `#graphql
      query PackShopId { shop { id } }`);
    await gql(
      admin,
      `#graphql
        mutation PackFreeShippingRemember($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } }
        }`,
      { metafields: [{ ownerId: shop.shop.id, ...SHOP_KEY, type: "single_line_text_field", value: discountId }] },
    );
    return;
  }

  await gql(
    admin,
    `#graphql
      mutation PackFreeShippingUpdate($id: ID!, $discount: DiscountAutomaticAppInput!) {
        discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $discount) {
          automaticAppDiscount { discountId }
          userErrors { field message }
        }
      }`,
    { id: current.discountId, discount: { title: title(threshold), metafields: [config] } },
  );
  if (settings.enabled !== current.enabled) {
    await gql(
      admin,
      settings.enabled
        ? `#graphql
            mutation PackFreeShippingOn($id: ID!) {
              discountAutomaticActivate(id: $id) { userErrors { field message } }
            }`
        : `#graphql
            mutation PackFreeShippingOff($id: ID!) {
              discountAutomaticDeactivate(id: $id) { userErrors { field message } }
            }`,
      { id: current.discountId },
    );
  }
}
