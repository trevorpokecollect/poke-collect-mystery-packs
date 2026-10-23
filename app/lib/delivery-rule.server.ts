// Turns the "Keep In My Vault" checkout rule on or off. The rule is the vault-singles-delivery
// delivery customization function (offers the $0 vault rate only to logged-in, singles-only carts);
// Shopify only runs it once a delivery customization points at it, and only this app can create that.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { gql } from "./orders.server";

const TITLE = "Keep In My Vault: singles only";
const HANDLE = "vault-singles-delivery";

export async function setVaultDeliveryRule(admin: AdminApiContext, enabled: boolean) {
  const data = await gql(admin, `#graphql
    query DeliveryRule {
      shopifyFunctions(first: 50, apiType: "delivery_customization") { nodes { id title } }
      deliveryCustomizations(first: 50) { nodes { id title enabled functionId } }
    }`);
  const fn = (data.shopifyFunctions.nodes as { id: string; title: string }[]).find(
    (f) => f.title === HANDLE || f.title.toLowerCase().includes("vault singles"),
  );
  if (!fn) throw new Error(`Function ${HANDLE} isn't deployed on this app.`);
  const existing = (data.deliveryCustomizations.nodes as { id: string; enabled: boolean; functionId: string }[]).find((c) => c.functionId === fn.id);
  if (existing) {
    if (existing.enabled === enabled) return { id: existing.id, enabled, changed: false };
    await gql(admin, `#graphql
      mutation DeliveryRuleUpdate($id: ID!, $input: DeliveryCustomizationInput!) {
        deliveryCustomizationUpdate(id: $id, deliveryCustomization: $input) { deliveryCustomization { id } userErrors { field message } }
      }`, { id: existing.id, input: { enabled } });
    return { id: existing.id, enabled, changed: true };
  }
  const created = await gql(admin, `#graphql
    mutation DeliveryRuleCreate($input: DeliveryCustomizationInput!) {
      deliveryCustomizationCreate(deliveryCustomization: $input) { deliveryCustomization { id enabled } userErrors { field message } }
    }`, { input: { functionId: fn.id, title: TITLE, enabled } });
  const errors = created.deliveryCustomizationCreate.userErrors as { message: string }[];
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
  return { id: created.deliveryCustomizationCreate.deliveryCustomization.id as string, enabled, changed: true };
}
