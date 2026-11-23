import {
  processOrder,
  type OrderWebhookPayload,
} from "./entries/orders.server";

// Backfill: replays past orders through the same processOrder path the
// orders/* webhooks use. processOrder is idempotent (it settles each order's
// ledger to its target), so re-running a range never double-awards.
// With read_orders, Shopify only returns the last 60 days of orders; older
// ones need the read_all_orders scope.

// Page sizes keep the requested query cost under Shopify's 1,000-point cap.
const ORDERS_PER_PAGE = 6;

export const BACKFILL_ORDERS_QUERY = `#graphql
  query BackfillOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        email
        createdAt
        cancelledAt
        sourceName
        customer {
          id
        }
        currentSubtotalPriceSet {
          shopMoney {
            amount
          }
        }
        currentTotalPriceSet {
          shopMoney {
            amount
          }
        }
        lineItems(first: 25) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            quantity
            currentQuantity
            product {
              id
            }
            variant {
              id
            }
            originalUnitPriceSet {
              shopMoney {
                amount
              }
            }
          }
        }
      }
    }
  }`;

// Large orders: fetch the rest of their line items.
const ORDER_LINES_QUERY = `#graphql
  query BackfillOrderLines($id: ID!, $after: String) {
    order(id: $id) {
      lineItems(first: 100, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          quantity
          currentQuantity
          product {
            id
          }
          variant {
            id
          }
          originalUnitPriceSet {
            shopMoney {
              amount
            }
          }
        }
      }
    }
  }`;

type Money = { shopMoney: { amount: string } } | null;

export interface GraphqlLineItem {
  quantity: number;
  currentQuantity: number;
  product: { id: string } | null;
  variant: { id: string } | null;
  originalUnitPriceSet: Money;
}

interface LineConnection {
  pageInfo?: { hasNextPage: boolean; endCursor: string | null };
  nodes: GraphqlLineItem[];
}

export interface GraphqlOrder {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  cancelledAt: string | null;
  sourceName: string | null;
  customer: { id: string } | null;
  currentSubtotalPriceSet: Money;
  currentTotalPriceSet: Money;
  lineItems: LineConnection;
}

/** "gid://shopify/Order/123" -> "123". The webhook uses bare numeric ids. */
export const legacyId = (gid: string | null | undefined) =>
  gid ? gid.slice(gid.lastIndexOf("/") + 1) : null;

/** Shapes an Admin GraphQL order like the REST webhook payload processOrder expects. */
export function toWebhookPayload(o: GraphqlOrder): OrderWebhookPayload {
  return {
    // Must match the webhook's numeric id so OrderLog rows line up.
    id: legacyId(o.id)!,
    name: o.name,
    email: o.email,
    created_at: o.createdAt,
    cancelled_at: o.cancelledAt,
    source_name: o.sourceName ?? undefined,
    subtotal_price: o.currentSubtotalPriceSet?.shopMoney.amount,
    total_price: o.currentTotalPriceSet?.shopMoney.amount,
    customer: o.customer ? { id: legacyId(o.customer.id)! } : null,
    line_items: o.lineItems.nodes.map((l) => ({
      product_id: legacyId(l.product?.id),
      variant_id: legacyId(l.variant?.id),
      quantity: l.quantity,
      current_quantity: l.currentQuantity,
      price: l.originalUnitPriceSet?.shopMoney.amount ?? "0",
    })),
  };
}

/** Shopify order search filter for a created_at window. */
export function orderSearchQuery(from?: Date | null, to?: Date | null) {
  return [
    from && `created_at:>='${from.toISOString()}'`,
    to && `created_at:<='${to.toISOString()}'`,
  ]
    .filter(Boolean)
    .join(" ");
}

export interface AdminGraphql {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs a query, waiting out Shopify's GraphQL rate limit if it is hit. */
async function request<T>(
  admin: AdminGraphql,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await admin.graphql(query, { variables });
      const body = (await res.json()) as { data?: T; errors?: unknown };
      if (body.data) return body.data;
      throw new Error(`Shopify query failed: ${JSON.stringify(body.errors)}`);
    } catch (err) {
      const detail = JSON.stringify(
        (err as { body?: unknown }).body ?? (err as Error).message,
      );
      if (attempt < 5 && /THROTTLED/i.test(detail)) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

async function allLines(admin: AdminGraphql, order: GraphqlOrder) {
  let page = order.lineItems.pageInfo;
  const nodes = [...order.lineItems.nodes];
  while (page?.hasNextPage) {
    const data = await request<{ order: { lineItems: LineConnection } | null }>(
      admin,
      ORDER_LINES_QUERY,
      { id: order.id, after: page.endCursor },
    );
    if (!data.order) break;
    nodes.push(...data.order.lineItems.nodes);
    page = data.order.lineItems.pageInfo;
  }
  return { ...order, lineItems: { nodes } };
}

// Orders per request; the admin page keeps calling with the returned cursor.
const MAX_PER_RUN = 120;

/** Processes up to MAX_PER_RUN orders from `cursor`. Returns where to resume. */
export async function backfillOrders(
  admin: AdminGraphql,
  shop: string,
  opts: { from?: Date | null; to?: Date | null; cursor?: string | null },
) {
  const query = orderSearchQuery(opts.from, opts.to);
  let after = opts.cursor ?? null;
  let processed = 0;
  let hasNext = true;
  while (hasNext && processed < MAX_PER_RUN) {
    const data = await request<{
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: GraphqlOrder[];
      };
    }>(admin, BACKFILL_ORDERS_QUERY, { first: ORDERS_PER_PAGE, after, query });
    for (const order of data.orders.nodes) {
      await processOrder(shop, toWebhookPayload(await allLines(admin, order)));
      processed++;
    }
    hasNext = data.orders.pageInfo.hasNextPage;
    after = data.orders.pageInfo.endCursor;
  }
  return { processed, cursor: hasNext ? after : null };
}
