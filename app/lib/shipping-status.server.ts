// Where each pulled card is in delivery, read from the order's fulfillments in Shopify.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { gql } from "./orders.server";

export type ShipState = "preparing" | "shipped" | "pickup_ready" | "picked_up";

export interface ShipStatus {
  state: ShipState;
  tracking: { company: string | null; number: string | null; url: string | null } | null;
}

interface OrderNode {
  id: string;
  fulfillmentOrders: {
    nodes: {
      status: string;
      deliveryMethod: { methodType: string } | null;
      lineItems: { nodes: { remainingQuantity: number; lineItem: { variant: { id: string } | null } }[] };
    }[];
  };
  fulfillments: {
    status: string;
    trackingInfo: { company: string | null; number: string | null; url: string | null }[];
    fulfillmentLineItems: { nodes: { lineItem: { variant: { id: string } | null } }[] };
  }[];
}

/**
 * Delivery state of each order's cards, keyed by `${orderId}|${cardVariantId}`.
 * Local pickup orders are "ready for pickup" as soon as the card is pulled; shipped orders are
 * "preparing" until a fulfillment that includes the card exists.
 */
export async function shippingStatuses(admin: AdminApiContext | undefined, orderIds: string[]) {
  const out = new Map<string, ShipStatus>();
  const pickupOrders = new Set<string>();
  if (!admin || orderIds.length === 0) return { statuses: out, pickupOrders };
  for (let i = 0; i < orderIds.length; i += 50) {
    try {
      const data = await gql<{ nodes: (OrderNode | null)[] }>(
        admin,
        `#graphql
          query PullShipping($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Order {
                id
                fulfillmentOrders(first: 10) {
                  nodes {
                    status
                    deliveryMethod { methodType }
                    lineItems(first: 100) { nodes { remainingQuantity lineItem { variant { id } } } }
                  }
                }
                fulfillments(first: 10) {
                  status
                  trackingInfo(first: 1) { company number url }
                  fulfillmentLineItems(first: 100) { nodes { lineItem { variant { id } } } }
                }
              }
            }
          }`,
        { ids: orderIds.slice(i, i + 50) },
      );
      for (const order of data.nodes) {
        if (!order?.id) continue;
        const pickup = order.fulfillmentOrders.nodes.some((fo) => fo.deliveryMethod?.methodType === "PICK_UP");
        if (pickup) pickupOrders.add(order.id);
        for (const f of order.fulfillments) {
          if (f.status === "CANCELLED" || f.status === "ERROR" || f.status === "FAILURE") continue;
          for (const li of f.fulfillmentLineItems.nodes) {
            const variant = li.lineItem.variant?.id;
            if (!variant) continue;
            out.set(`${order.id}|${variant}`, {
              state: pickup ? "picked_up" : "shipped",
              tracking: pickup ? null : (f.trackingInfo[0] ?? null),
            });
          }
        }
      }
    } catch (error) {
      console.error("Could not load shipping status", error);
    }
  }
  return { statuses: out, pickupOrders };
}

export function shipStatusFor(
  result: Awaited<ReturnType<typeof shippingStatuses>>,
  orderId: string,
  variantId: string,
): ShipStatus {
  return (
    result.statuses.get(`${orderId}|${variantId}`) ?? {
      state: result.pickupOrders.has(orderId) ? "pickup_ready" : "preparing",
      tracking: null,
    }
  );
}
