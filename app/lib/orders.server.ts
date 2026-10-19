// Shopify side of the pack lifecycle: holding fulfillment while packs are unopened,
// then adding the won cards to the order and releasing it to ship.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { PrismaClient } from "@prisma/client";
import { unreserveForPulls } from "./inventory.server";

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
    // orders/create and orders/paid can both arrive at once for the same order; if the other
    // webhook placed this hold first, Shopify rejects the duplicate handle, which is fine.
    try {
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
    } catch (error) {
      if (error instanceof Error && /already in use/i.test(error.message)) continue;
      throw error;
    }
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

/**
 * Vault orders: the pack lines never ship (cards go to the vault), so they're marked fulfilled at
 * payment and the order doesn't sit in the unfulfilled queue. Opening packs doesn't depend on it.
 */
export async function fulfillVaultPackLines(db: PrismaClient, admin: Admin, orderId: string) {
  const packOrder = await db.packOrder.findUnique({ where: { orderId } });
  if (!packOrder?.vault || packOrder.packLinesFulfilledAt) return false;
  const packVariants = new Set(
    (await db.series.findMany({ where: { shop: packOrder.shop }, select: { packVariantId: true } })).map((s) => s.packVariantId),
  );
  await fulfillPackLines(admin, orderId, packVariants);
  await db.packOrder.update({ where: { orderId }, data: { packLinesFulfilledAt: new Date() } });
  return true;
}

/** Vault orders paid before pack lines were fulfilled at payment. */
export async function fulfillMissingVaultPackLines(db: PrismaClient, adminFor: (shop: string) => Promise<Admin>) {
  const orders = await db.packOrder.findMany({ where: { vault: true, packLinesFulfilledAt: null }, take: 50 });
  for (const o of orders) {
    try {
      await fulfillVaultPackLines(db, await adminFor(o.shop), o.orderId);
    } catch (error) {
      console.error(`Fulfilling pack lines on ${o.orderId} failed`, error);
    }
  }
}

/**
 * Vault Market purchases: the card changes owners inside the vault the moment the order is paid,
 * so there's nothing for staff to ship. Every open line is marked fulfilled (no customer email).
 */
export async function fulfillWholeOrder(admin: Admin, orderId: string) {
  for (const fo of await fulfillmentOrders(admin, orderId)) {
    if (fo.status !== "OPEN" && fo.status !== "IN_PROGRESS") continue;
    const lines = fo.lineItems.nodes.filter((l) => l.remainingQuantity > 0);
    if (lines.length === 0) continue;
    const data = await gql(
      admin,
      `#graphql
        mutation MarketFulfill($fulfillment: FulfillmentInput!) {
          fulfillmentCreate(fulfillment: $fulfillment) {
            fulfillment { id }
            userErrors { field message }
          }
        }`,
      {
        fulfillment: {
          notifyCustomer: false,
          lineItemsByFulfillmentOrder: [
            { fulfillmentOrderId: fo.id, fulfillmentOrderLineItems: lines.map((l) => ({ id: l.id, quantity: l.remainingQuantity })) },
          ],
        },
      },
    );
    const errors = data.fulfillmentCreate.userErrors as { message: string }[];
    if (errors.length) throw new Error(`Fulfilling ${orderId}: ${errors.map((e) => e.message).join("; ")}`);
  }
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

  // Vault orders keep their cards in the vault; only the pack lines are closed out.
  if (pulls.length > 0 && !packOrder.cardsAddedAt && !packOrder.vault) {
    // Auto-built pools hold their cards as "reserved"; free each won copy so the edit can commit it.
    await unreserveForPulls(db, admin, pulls.map((p) => p.id));
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

  if (packOrder.vault && pulls.length > 0 && !packOrder.pullsNotedAt) {
    await noteVaultPulls(admin, orderId, pulls.map((p) => `${p.slot.card.title} (${p.slot.card.tier})`));
    await db.packOrder.update({ where: { orderId }, data: { pullsNotedAt: new Date() } });
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

/** Notes the pulls on finalized vault orders that don't have them yet (e.g. finalized before notes existed). */
export async function noteMissingVaultPulls(db: PrismaClient, adminFor: (shop: string) => Promise<Admin>) {
  const orders = await db.packOrder.findMany({ where: { vault: true, finalized: true, pullsNotedAt: null }, take: 50 });
  for (const order of orders) {
    try {
      const pulls = await db.pull.findMany({
        where: { orderId: order.orderId, status: { not: "VOIDED" } },
        include: { slot: { include: { card: true } } },
        orderBy: [{ packIndex: "asc" }, { cardIndex: "asc" }],
      });
      if (pulls.length > 0) {
        await noteVaultPulls(await adminFor(order.shop), order.orderId, pulls.map((p) => `${p.slot.card.title} (${p.slot.card.tier})`));
      }
      await db.packOrder.update({ where: { orderId: order.orderId }, data: { pullsNotedAt: new Date() } });
    } catch (error) {
      console.error(`Noting pulls on ${order.orderId} failed`, error);
    }
  }
}

/**
 * Vault orders don't carry the cards as line items, so the pulls are listed in the order's note
 * (after any note already there) for staff to see on the order page.
 */
export async function noteVaultPulls(admin: Admin, orderId: string, cards: string[]) {
  const data = await gql(admin, `#graphql
    query PackOrderNote($id: ID!) { order(id: $id) { note } }`, { id: orderId });
  const existing: string = data.order?.note ?? "";
  if (existing.includes("Mystery pack pulls")) return;
  // Shopify caps notes at 5000 characters: shorten titles, combine duplicates, and cut off with a count.
  const counts = new Map<string, number>();
  for (const c of cards) {
    const short = c.replace(/ - Near Mint/g, "").replace(/\s+(Holofoil|Reverse Holofoil|Normal)(?=\s*\()/g, "");
    counts.set(short, (counts.get(short) ?? 0) + 1);
  }
  const header = `Mystery pack pulls (${cards.length} cards, in the customer's vault, not shipped with this order):`;
  const budget = 5000 - existing.length - header.length - 80;
  const lines: string[] = [];
  let used = 0;
  for (const [title, n] of counts) {
    const line = `- ${n > 1 ? `${n}x ` : ""}${title.length > 90 ? title.slice(0, 87) + "..." : title}`;
    if (used + line.length + 1 > budget) {
      lines.push(`- ...and ${cards.length - lines.reduce((t, l) => t + (Number(l.match(/^- (\d+)x /)?.[1]) || 1), 0)} more (full list in the app)`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  const list = `${header}\n${lines.join("\n")}`;
  await gql(
    admin,
    `#graphql
      mutation PackOrderNoteSet($input: OrderInput!) {
        orderUpdate(input: $input) { order { id } userErrors { field message } }
      }`,
    { input: { id: orderId, note: existing ? `${existing}\n\n${list}` : list } },
  );
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
