// Shopify side of the pack lifecycle: holding fulfillment while packs are unopened,
// then adding the won cards to the order and releasing it to ship.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { PrismaClient } from "@prisma/client";

const HOLD_HANDLE = "mystery-pack-reveal";

type Admin = AdminApiContext;

// Responses are untyped here (no GraphQL codegen yet), so callers read fields directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function gql<T = any>(
  admin: Admin,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await response.json()) as { data?: any; errors?: unknown };
  if (json.errors) throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
  for (const payload of Object.values(json.data ?? {})) {
    const errors = (payload as { userErrors?: { message: string }[] } | null)?.userErrors;
    if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  }
  return json.data as T;
}

const FULFILLMENT_ORDERS = `#graphql
  query PackFulfillmentOrders($id: ID!) {
    order(id: $id) {
      id
      fulfillmentOrders(first: 20) {
        nodes {
          id
          status
          fulfillmentHolds { id handle heldByRequestingApp }
          lineItems(first: 50) {
            nodes { id remainingQuantity lineItem { id variant { id } } }
          }
        }
      }
    }
  }`;

interface FulfillmentOrderNode {
  id: string;
  status: string;
  fulfillmentHolds: { id: string; handle: string | null; heldByRequestingApp: boolean }[];
  lineItems: {
    nodes: {
      id: string;
      remainingQuantity: number;
      lineItem: { id: string; variant: { id: string } | null };
    }[];
  };
}

async function fulfillmentOrders(admin: Admin, orderId: string): Promise<FulfillmentOrderNode[]> {
  const data = await gql(admin, FULFILLMENT_ORDERS, { id: orderId });
  return data.order?.fulfillmentOrders.nodes ?? [];
}

/** Puts every open fulfillment order on hold so nothing ships before the packs are opened. */
export async function holdOrder(admin: Admin, orderId: string) {
  for (const fo of await fulfillmentOrders(admin, orderId)) {
    if (fo.fulfillmentHolds.some((h) => h.handle === HOLD_HANDLE)) continue;
    if (fo.status !== "OPEN" && fo.status !== "ON_HOLD" && fo.status !== "SCHEDULED") continue;
    await gql(
      admin,
      `#graphql
        mutation PackHold($id: ID!, $hold: FulfillmentOrderHoldInput!) {
          fulfillmentOrderHold(id: $id, fulfillmentHold: $hold) {
            fulfillmentOrder { id status }
            userErrors { field message }
          }
        }`,
      {
        id: fo.id,
        hold: {
          reason: "OTHER",
          handle: HOLD_HANDLE,
          reasonNotes: "Waiting for the customer to open their mystery packs.",
          notifyMerchant: false,
        },
      },
    );
  }
}

export async function releaseHolds(admin: Admin, orderId: string) {
  for (const fo of await fulfillmentOrders(admin, orderId)) {
    const ours = fo.fulfillmentHolds.filter((h) => h.handle === HOLD_HANDLE).map((h) => h.id);
    if (ours.length === 0) continue;
    await gql(
      admin,
      `#graphql
        mutation PackRelease($id: ID!, $holdIds: [ID!]) {
          fulfillmentOrderReleaseHold(id: $id, holdIds: $holdIds) {
            fulfillmentOrder { id status }
            userErrors { field message }
          }
        }`,
      { id: fo.id, holdIds: ours },
    );
  }
}

/** Adds each won card to the order at 100% off, so it is picked, packed and shipped normally. */
async function addCardsToOrder(admin: Admin, orderId: string, variantIds: string[], orderName: string) {
  const counts = new Map<string, number>();
  for (const id of variantIds) counts.set(id, (counts.get(id) ?? 0) + 1);

  const begin = await gql(
    admin,
    `#graphql
      mutation PackEditBegin($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder { id }
          userErrors { field message }
        }
      }`,
    { id: orderId },
  );
  const calculatedOrderId: string = begin.orderEditBegin.calculatedOrder.id;

  for (const [variantId, quantity] of counts) {
    const added = await gql(
      admin,
      `#graphql
        mutation PackEditAdd($id: ID!, $variantId: ID!, $quantity: Int!) {
          orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity, allowDuplicates: true) {
            calculatedLineItem { id }
            userErrors { field message }
          }
        }`,
      { id: calculatedOrderId, variantId, quantity },
    );
    await gql(
      admin,
      `#graphql
        mutation PackEditDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
          orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
            calculatedLineItem { id }
            userErrors { field message }
          }
        }`,
      {
        id: calculatedOrderId,
        lineItemId: added.orderEditAddVariant.calculatedLineItem.id,
        discount: { percentValue: 100, description: "Mystery pack pull" },
      },
    );
  }

  await gql(
    admin,
    `#graphql
      mutation PackEditCommit($id: ID!, $staffNote: String) {
        orderEditCommit(id: $id, notifyCustomer: false, staffNote: $staffNote) {
          order { id }
          userErrors { field message }
        }
      }`,
    { id: calculatedOrderId, staffNote: `Mystery pack pulls added for ${orderName}` },
  );
}

/** Marks the pack line items themselves as fulfilled: they were opened online, nothing ships for them. */
async function fulfillPackLines(admin: Admin, orderId: string, packVariantIds: Set<string>) {
  for (const fo of await fulfillmentOrders(admin, orderId)) {
    if (fo.status !== "OPEN" && fo.status !== "IN_PROGRESS") continue;
    const lines = fo.lineItems.nodes.filter(
      (l) => l.remainingQuantity > 0 && l.lineItem.variant && packVariantIds.has(l.lineItem.variant.id),
    );
    if (lines.length === 0) continue;
    await gql(
      admin,
      `#graphql
        mutation PackFulfill($fulfillment: FulfillmentInput!) {
          fulfillmentCreate(fulfillment: $fulfillment) {
            fulfillment { id }
            userErrors { field message }
          }
        }`,
      {
        fulfillment: {
          notifyCustomer: false,
          lineItemsByFulfillmentOrder: [
            {
              fulfillmentOrderId: fo.id,
              fulfillmentOrderLineItems: lines.map((l) => ({ id: l.id, quantity: l.remainingQuantity })),
            },
          ],
        },
      },
    );
  }
}

/**
 * Once every pack on an order is revealed: add the cards, release our hold, and close out
 * the pack line items. Safe to call repeatedly; each step checks what is already done.
 */
export async function finalizeOrder(db: PrismaClient, admin: Admin, orderId: string) {
  if (await db.pull.count({ where: { orderId, status: "UNOPENED" } })) return false;

  // Take a 5-minute lease; whoever loses simply returns and a later run retries.
  const now = new Date();
  const lease = await db.packOrder.updateMany({
    where: {
      orderId,
      finalized: false,
      OR: [{ finalizingAt: null }, { finalizingAt: { lt: new Date(now.getTime() - 5 * 60_000) } }],
    },
    data: { finalizingAt: now },
  });
  if (lease.count === 0) return false;

  try {
    return await finalizeLeased(db, admin, orderId);
  } finally {
    await db.packOrder.update({ where: { orderId }, data: { finalizingAt: null } });
  }
}

async function finalizeLeased(db: PrismaClient, admin: Admin, orderId: string) {
  const packOrder = await db.packOrder.findUniqueOrThrow({ where: { orderId } });

  const pulls = await db.pull.findMany({
    where: { orderId, status: "REVEALED" },
    include: { slot: { include: { card: true } }, series: true },
  });

  if (pulls.length > 0 && !packOrder.cardsAddedAt) {
    await addCardsToOrder(
      admin,
      orderId,
      pulls.map((p) => p.slot.card.variantId),
      packOrder.orderName,
    );
    await db.$transaction([
      db.packOrder.update({ where: { orderId }, data: { cardsAddedAt: new Date() } }),
      db.pull.updateMany({
        where: { id: { in: pulls.map((p) => p.id) } },
        data: { status: "FULFILLING", fulfillingAt: new Date() },
      }),
    ]);
  }

  await releaseHolds(admin, orderId);
  const packVariants = new Set(
    (await db.series.findMany({ where: { shop: packOrder.shop }, select: { packVariantId: true } })).map(
      (s) => s.packVariantId,
    ),
  );
  await fulfillPackLines(admin, orderId, packVariants);
  await db.packOrder.update({ where: { orderId }, data: { finalized: true, held: false } });
  return true;
}

/** Stores the "open your packs" link on the order so notification templates can show it. */
export async function setOpenLinkMetafield(admin: Admin, orderId: string, url: string) {
  await gql(
    admin,
    `#graphql
      mutation PackMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
    {
      metafields: [
        { ownerId: orderId, namespace: "mystery_packs", key: "open_url", type: "url", value: url },
      ],
    },
  );
}

export async function tagOrder(admin: Admin, orderId: string, tags: string[]) {
  await gql(
    admin,
    `#graphql
      mutation PackTag($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          node { id }
          userErrors { field message }
        }
      }`,
    { id: orderId, tags },
  );
}
