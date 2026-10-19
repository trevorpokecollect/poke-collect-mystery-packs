// Turns the "no store credit on Mystery Packs" checkout rule on or off. The rule is the
// pack-no-store-credit payment customization function; Shopify only runs it once a payment
// customization points at it, and only this app can create that.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { gql } from "./orders.server";

const TITLE = "No store credit on Mystery Packs";
const HANDLE = "pack-no-store-credit";

export async function setStoreCreditRule(admin: AdminApiContext, enabled: boolean) {
  const data = await gql(admin, `#graphql
    query PaymentRule {
      shopifyFunctions(first: 50, apiType: "payment_customization") { nodes { id title app { title } } }
      paymentCustomizations(first: 50) { nodes { id title enabled functionId } }
    }`);
  const fn = (data.shopifyFunctions.nodes as { id: string; title: string }[]).find((f) => f.title === HANDLE || f.title.includes("Store Credit") || f.title.includes("store-credit"));
  if (!fn) throw new Error(`Function ${HANDLE} isn't deployed on this app.`);
  const existing = (data.paymentCustomizations.nodes as { id: string; enabled: boolean; functionId: string }[]).find((c) => c.functionId === fn.id);
  if (existing) {
    if (existing.enabled === enabled) return { id: existing.id, enabled, changed: false };
    await gql(admin, `#graphql
      mutation PaymentRuleUpdate($id: ID!, $input: PaymentCustomizationInput!) {
        paymentCustomizationUpdate(id: $id, paymentCustomization: $input) { paymentCustomization { id } userErrors { field message } }
      }`, { id: existing.id, input: { enabled } });
    return { id: existing.id, enabled, changed: true };
  }
  const created = await gql(admin, `#graphql
    mutation PaymentRuleCreate($input: PaymentCustomizationInput!) {
      paymentCustomizationCreate(paymentCustomization: $input) { paymentCustomization { id enabled } userErrors { field message } }
    }`, { input: { functionId: fn.id, title: TITLE, enabled } });
  return { id: created.paymentCustomizationCreate.paymentCustomization.id as string, enabled, changed: true };
}
