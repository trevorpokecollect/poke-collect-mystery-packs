import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

// Ask Shopify for the current subscription of the signed-in Cardbit customer.
export async function subscribers(admin: AdminApiContext, ids: string[]) {
  const result = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const res = await admin.graphql(
      `#graphql
      query CardbitGiveawayConsent($ids: [ID!]!) {
        nodes(ids: $ids) { ... on Customer { id defaultEmailAddress { marketingState } } }
      }`,
      { variables: { ids: ids.slice(i, i + 100) } },
    );
    const body = await res.json();
    if (
      !res.ok ||
      ("errors" in body && body.errors) ||
      !Array.isArray(body.data?.nodes)
    )
      throw Error(
        "Email subscription status is unavailable. Try again shortly.",
      );
    for (const node of body.data.nodes)
      if (node?.defaultEmailAddress?.marketingState === "SUBSCRIBED")
        result.add(node.id);
  }
  return result;
}
