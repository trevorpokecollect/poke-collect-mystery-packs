// The card vault: pulled cards stay with us until the customer asks to have them shipped.
// "Ship my cards" makes one draft order for the vaulted cards (free) plus a flat shipping fee;
// paying its invoice creates a normal order that ships like any other.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { PrismaClient } from "@prisma/client";
import { gql } from "./orders.server";
import { rereserveForPulls, unreserveForPulls } from "./inventory.server";
import { pullsForViewer, PoolError, type Viewer } from "./pool.server";

export const SHIP_FEE = 5;
/** Shipping is free once a single shipment has this many cards. */
export const FREE_SHIPPING_CARDS = 25;
/** How long an unpaid shipping invoice holds the cards before they go back to the vault. */
const INVOICE_DAYS = 7;
export const VAULT_TAG = "mystery-vault-shipment";
export const VAULT_ATTRIBUTE = "_vault_request";
/** Vault orders the customer collects in store instead of having shipped. */
export const PICKUP_TAG = "vault-pickup";
/** Staff add this tag to a pickup order once the cards are set out; the customer is then emailed. */
export const PICKUP_READY_TAG = "pickup-ready";
export const PICKUP_READY_METRIC = "Vault Pickup Ready";
export const PICKUP_LOCATION = {
  address: "181 Hughes Road, Suite 5, Madison, AL 35758",
  hours: "Wed-Thu 11am-7pm, Fri-Sat 11am-9pm, Sun 11am-7pm CST (closed Mon-Tue)",
};

export const shippingFeeFor = (cards: number) => (cards >= FREE_SHIPPING_CARDS ? 0 : SHIP_FEE);

type Db = PrismaClient;

/** The viewer's cards that are in the vault: opened, on a vault order, and not on a live ship request. */
export async function vaultedPulls(db: Db, shop: string, viewer: Viewer) {
  const pulls = (await pullsForViewer(db, shop, viewer)).filter((p) => p.status === "REVEALED");
  if (pulls.length === 0) return [];
  const vaultOrders = new Set(
    (
      await db.packOrder.findMany({
        where: { orderId: { in: [...new Set(pulls.map((p) => p.orderId))] }, vault: true },
        select: { orderId: true },
      })
    ).map((o) => o.orderId),
  );
  return pulls.filter((p) => vaultOrders.has(p.orderId));
}

/**
 * Starts (or returns the open) shipment for the viewer's vaulted cards and returns the invoice
 * link to pay shipping. Each card's reserved copy is handed to the draft order's own reservation.
 */
export async function requestShipment(
  db: Db,
  admin: AdminApiContext,
  shop: string,
  viewer: Viewer,
  { pickup = false }: { pickup?: boolean } = {},
): Promise<{ invoiceUrl: string | null; reused: boolean; pickupOrder?: string }> {
  const inVault = await vaultedPulls(db, shop, viewer);
  const pending = inVault.find((p) => p.shipRequest?.status === "PENDING")?.shipRequest;
  if (pending?.invoiceUrl) {
    if (!pickup && inVault.every((p) => p.shipRequestId === pending.id)) return { invoiceUrl: pending.invoiceUrl, reused: true };
    // Cards opened since the open invoice was made, or picking up instead: replace the invoice.
    const request = await db.shipRequest.findUniqueOrThrow({ where: { id: pending.id } });
    await settleShipRequest(db, admin, request, "CANCELLED");
    return requestShipment(db, admin, shop, viewer, { pickup });
  }

  const pulls = inVault.filter((p) => !p.shipRequestId || p.shipRequest?.status !== "PENDING");
  if (pulls.length === 0) throw new PoolError(`There are no cards in your vault to ${pickup ? "pick up" : "ship"} yet.`);

  // Vault shipping is US only: refuse up front when the customer's address on their latest pack order is abroad.
  if (!pickup) {
    const latest = pulls.reduce((a, p) => (p.createdAt > a.createdAt ? p : a), pulls[0]);
    const country = await orderCountry(admin, latest.orderId);
    if (country && country !== "US") {
      throw new PoolError("Ship My Cards is available for US addresses only. Email support@poke-collect.com and we'll sort out your shipment.");
    }
  }

  const fee = pickup ? 0 : shippingFeeFor(pulls.length);
  const expiresAt = new Date(Date.now() + INVOICE_DAYS * 86_400_000);
  const customerId = viewer.customerId ?? pulls.find((p) => p.customerId)?.customerId ?? null;
  const request = await db.shipRequest.create({
    data: { shop, customerId, cardCount: pulls.length, shippingFee: fee, expiresAt, pickup },
  });
  const claimed = await db.pull.updateMany({
    where: { id: { in: pulls.map((p) => p.id) }, status: "REVEALED", OR: [{ shipRequestId: null }, { shipRequest: { status: { not: "PENDING" } } }] },
    data: { shipRequestId: request.id },
  });
  if (claimed.count !== pulls.length) {
    await db.pull.updateMany({ where: { shipRequestId: request.id }, data: { shipRequestId: null } });
    await db.shipRequest.update({ where: { id: request.id }, data: { status: "CANCELLED" } });
    throw new PoolError("Your vault just changed. Please try again.");
  }

  try {
    await unreserveForPulls(db, admin, pulls.map((p) => p.id));
    const email = customerId ? null : await orderEmail(admin, pulls[0].orderId);
    const counts = new Map<string, number>();
    for (const p of pulls) counts.set(p.slot.card.variantId, (counts.get(p.slot.card.variantId) ?? 0) + 1);
    const data = await gql(
      admin,
      `#graphql
        mutation VaultDraft($input: DraftOrderInput!) {
          draftOrderCreate(input: $input) {
            draftOrder { id invoiceUrl }
            userErrors { field message }
          }
        }`,
      {
        input: {
          ...(customerId ? { purchasingEntity: { customerId } } : {}),
          ...(email ? { email } : {}),
          tags: pickup ? [VAULT_TAG, PICKUP_TAG] : [VAULT_TAG],
          note: `${pickup ? "Local pickup" : "Vault shipment"}: ${pulls.length} card${pulls.length === 1 ? "" : "s"} from ${[...new Set(pulls.map((p) => p.orderName))].join(", ")}`,
          customAttributes: [{ key: VAULT_ATTRIBUTE, value: request.id }],
          reserveInventoryUntil: expiresAt.toISOString(),
          shippingLine: pickup
            ? { title: "Local Pickup", priceWithCurrency: { amount: "0.00", currencyCode: await shopCurrency(admin) } }
            : {
                title: fee ? `Vault shipment ($${SHIP_FEE} flat)` : `Vault shipment (free on ${FREE_SHIPPING_CARDS}+ cards)`,
                priceWithCurrency: { amount: fee.toFixed(2), currencyCode: await shopCurrency(admin) },
              },
          lineItems: [...counts].map(([variantId, quantity]) => ({
            variantId,
            quantity,
            appliedDiscount: { value: 100, valueType: "PERCENTAGE", title: "Mystery pack pull" },
          })),
        },
      },
    );
    const draft = data.draftOrderCreate.draftOrder as { id: string; invoiceUrl: string };
    await db.shipRequest.update({
      where: { id: request.id },
      data: { draftOrderId: draft.id, invoiceUrl: draft.invoiceUrl },
    });
    if (pickup) {
      // Nothing to pay: complete the order now so the cards are set aside for pickup.
      const done = await gql(
        admin,
        `#graphql
          mutation VaultPickupComplete($id: ID!) {
            draftOrderComplete(id: $id) { draftOrder { order { id name } } userErrors { field message } }
          }`,
        { id: draft.id },
      );
      const placed = done.draftOrderComplete.draftOrder.order as { id: string; name: string };
      await markShipmentPaid(db, request.id, placed.id);
      return { invoiceUrl: null, reused: false, pickupOrder: placed.name };
    }
    return { invoiceUrl: draft.invoiceUrl, reused: false };
  } catch (error) {
    // Put everything back the way it was: cards reserved again and back in the vault.
    await rereserveForPulls(db, admin, pulls.map((p) => p.id)).catch((e) => console.error("Re-reserve failed", e));
    await db.pull.updateMany({ where: { shipRequestId: request.id }, data: { shipRequestId: null } });
    await db.shipRequest.update({ where: { id: request.id }, data: { status: "CANCELLED" } });
    throw error;
  }
}

/** The paid vault order: its cards are now shipping on `orderId`. */
export async function markShipmentPaid(db: Db, requestId: string, orderId: string) {
  const request = await db.shipRequest.findUnique({ where: { id: requestId } });
  if (!request || request.status === "PAID") return false;
  await db.$transaction([
    db.shipRequest.update({ where: { id: requestId }, data: { status: "PAID", orderId } }),
    db.pull.updateMany({
      where: { shipRequestId: requestId, status: "REVEALED" },
      data: { status: "FULFILLING", fulfillingAt: new Date(), shipOrderId: orderId },
    }),
  ]);
  return true;
}

/**
 * Settles ship requests whose invoice has lapsed: if the draft order was in fact paid, records
 * it; otherwise deletes the draft and returns the cards to the vault (reserved again).
 */
export async function expireShipments(db: Db, adminFor: (shop: string) => Promise<AdminApiContext>, now = new Date()) {
  const due = await db.shipRequest.findMany({ where: { status: "PENDING", expiresAt: { lt: now } } });
  for (const request of due) {
    try {
      await settleShipRequest(db, await adminFor(request.shop), request, "EXPIRED");
    } catch (error) {
      console.error(`Expiring ship request ${request.id} failed`, error);
    }
  }
}

/**
 * Closes an unpaid ship request: if its draft order was in fact paid, records that; otherwise
 * deletes the draft and returns the cards to the vault (reserved again) with the given status.
 */
async function settleShipRequest(
  db: Db,
  admin: AdminApiContext,
  request: { id: string; draftOrderId: string | null },
  status: "EXPIRED" | "CANCELLED",
) {
  if (request.draftOrderId) {
    const data = await gql(
      admin,
      `#graphql
        query VaultDraftStatus($id: ID!) {
          draftOrder(id: $id) { id status order { id } }
        }`,
      { id: request.draftOrderId },
    );
    const draft = data.draftOrder as { status: string; order: { id: string } | null } | null;
    if (draft?.order) {
      await markShipmentPaid(db, request.id, draft.order.id);
      return;
    }
    if (draft) {
      await gql(
        admin,
        `#graphql
          mutation VaultDraftDelete($input: DraftOrderDeleteInput!) {
            draftOrderDelete(input: $input) { deletedId userErrors { field message } }
          }`,
        { input: { id: request.draftOrderId } },
      );
    }
  }
  const pulls = await db.pull.findMany({ where: { shipRequestId: request.id }, select: { id: true } });
  await rereserveForPulls(db, admin, pulls.map((p) => p.id));
  await db.$transaction([
    db.pull.updateMany({ where: { shipRequestId: request.id }, data: { shipRequestId: null } }),
    db.shipRequest.update({ where: { id: request.id }, data: { status } }),
  ]);
}

/**
 * Adds the customer's other vaulted cards to a paid vault shipment that hasn't shipped yet,
 * at no charge, so everything goes out in one package. Returns how many cards were added.
 */
export async function addVaultCardsToShipment(db: Db, admin: AdminApiContext, shop: string, requestId: string) {
  const request = await db.shipRequest.findFirst({ where: { id: requestId, shop } });
  if (!request || request.status !== "PAID" || !request.orderId || !request.customerId) {
    throw new PoolError("That shipment isn't a paid vault order with a customer.");
  }
  // An open invoice for the same cards would charge shipping again: cancel it first.
  const viewer = { customerId: request.customerId };
  const pendingIds = new Set(
    (await vaultedPulls(db, shop, viewer)).filter((p) => p.shipRequest?.status === "PENDING").map((p) => p.shipRequestId!),
  );
  for (const id of pendingIds) {
    await settleShipRequest(db, admin, await db.shipRequest.findUniqueOrThrow({ where: { id } }), "CANCELLED");
  }
  const pulls = (await vaultedPulls(db, shop, viewer)).filter((p) => !p.shipRequestId || p.shipRequest?.status !== "PENDING");
  if (pulls.length === 0) return 0;
  const ids = pulls.map((p) => p.id);
  const claimed = await db.pull.updateMany({ where: { id: { in: ids }, status: "REVEALED" }, data: { shipRequestId: request.id } });
  if (claimed.count !== ids.length) {
    await db.pull.updateMany({ where: { id: { in: ids } }, data: { shipRequestId: null } });
    throw new PoolError("The vault just changed. Please try again.");
  }
  try {
    await unreserveForPulls(db, admin, ids);
    const begin = await gql(
      admin,
      `#graphql
        mutation VaultEditBegin($id: ID!) {
          orderEditBegin(id: $id) { calculatedOrder { id } userErrors { field message } }
        }`,
      { id: request.orderId },
    );
    const calculatedId = begin.orderEditBegin.calculatedOrder.id as string;
    const counts = new Map<string, number>();
    for (const p of pulls) counts.set(p.slot.card.variantId, (counts.get(p.slot.card.variantId) ?? 0) + 1);
    for (const [variantId, quantity] of counts) {
      const added = await gql(
        admin,
        `#graphql
          mutation VaultEditAdd($id: ID!, $variantId: ID!, $quantity: Int!) {
            orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity, allowDuplicates: true) {
              calculatedLineItem { id }
              userErrors { field message }
            }
          }`,
        { id: calculatedId, variantId, quantity },
      );
      await gql(
        admin,
        `#graphql
          mutation VaultEditDiscount($id: ID!, $lineItemId: ID!) {
            orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: { percentValue: 100, description: "Mystery pack pull" }) {
              userErrors { field message }
            }
          }`,
        { id: calculatedId, lineItemId: added.orderEditAddVariant.calculatedLineItem.id },
      );
    }
    await gql(
      admin,
      `#graphql
        mutation VaultEditCommit($id: ID!, $note: String) {
          orderEditCommit(id: $id, notifyCustomer: false, staffNote: $note) { order { id } userErrors { field message } }
        }`,
      { id: calculatedId, note: `Added ${pulls.length} more vault card${pulls.length === 1 ? "" : "s"} at no charge` },
    );
  } catch (error) {
    await rereserveForPulls(db, admin, ids).catch((e) => console.error("Re-reserve failed", e));
    await db.pull.updateMany({ where: { id: { in: ids } }, data: { shipRequestId: null } });
    throw error;
  }
  await db.$transaction([
    db.pull.updateMany({
      where: { id: { in: ids } },
      data: { status: "FULFILLING", fulfillingAt: new Date(), shipOrderId: request.orderId },
    }),
    db.shipRequest.update({ where: { id: request.id }, data: { cardCount: { increment: ids.length } } }),
  ]);
  return ids.length;
}

/**
 * Customer service: undoes a vault shipment and puts its cards back in the customer's vault.
 * An unpaid invoice is deleted. A paid order that hasn't shipped is cancelled in Shopify and its
 * shipping payment refunded to the original payment method; its cards are restocked and reserved again.
 */
export async function returnShipmentToVault(db: Db, admin: AdminApiContext, shop: string, requestId: string) {
  const request = await db.shipRequest.findFirst({ where: { id: requestId, shop } });
  if (!request) throw new PoolError("Shipment not found.");
  const cards = await db.pull.count({ where: { shipRequestId: request.id } });
  if (request.status === "PENDING") {
    await settleShipRequest(db, admin, request, "CANCELLED");
    const after = await db.shipRequest.findUniqueOrThrow({ where: { id: request.id } });
    if (after.status === "PAID") return returnShipmentToVault(db, admin, shop, requestId);
    return { cards, cancelledOrder: null as string | null };
  }
  if (request.status !== "PAID" || !request.orderId) throw new PoolError("This shipment is already closed.");

  const data = await gql(admin, `#graphql
    query VaultReturnOrder($id: ID!) { order(id: $id) { name cancelledAt displayFulfillmentStatus } }`, { id: request.orderId });
  const order = data.order as { name: string; cancelledAt: string | null; displayFulfillmentStatus: string } | null;
  if (!order) throw new PoolError("The shipment's Shopify order wasn't found.");
  if (order.displayFulfillmentStatus !== "UNFULFILLED") {
    throw new PoolError(`${order.name} has already been fulfilled, so its cards can't go back to the vault.`);
  }
  if (!order.cancelledAt) {
    await gql(
      admin,
      `#graphql
        mutation VaultReturnCancel($orderId: ID!, $note: String) {
          orderCancel(orderId: $orderId, reason: CUSTOMER, refundMethod: { originalPaymentMethodsRefund: true }, restock: true, notifyCustomer: false, staffNote: $note) {
            orderCancelUserErrors { field message }
          }
        }`,
      { orderId: request.orderId, note: `Cards returned to the customer's vault (${cards} card${cards === 1 ? "" : "s"}); shipping refunded.` },
    );
    // Cancelling runs as a job: wait for it so the restocked copies are there to reserve again.
    let cancelled = false;
    for (let i = 0; i < 20; i++) {
      const check = await gql(admin, `#graphql
        query VaultReturnCancelled($id: ID!) { order(id: $id) { cancelledAt } }`, { id: request.orderId });
      if (check.order?.cancelledAt) {
        cancelled = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    // Return guard: never re-reserve cards the order still holds. Running it again finishes the
    // return once Shopify has cancelled the order (the cancel step is skipped then).
    if (!cancelled) throw new PoolError(`Shopify is still cancelling ${order.name}. Wait a minute, then click Return To Vault again.`);
  }
  const pulls = await db.pull.findMany({ where: { shipRequestId: request.id }, select: { id: true } });
  await rereserveForPulls(db, admin, pulls.map((p) => p.id));
  await db.$transaction([
    db.pull.updateMany({
      where: { shipRequestId: request.id, status: "FULFILLING" },
      data: { status: "REVEALED", fulfillingAt: null, shipOrderId: null },
    }),
    db.pull.updateMany({ where: { shipRequestId: request.id }, data: { shipRequestId: null } }),
    db.shipRequest.update({ where: { id: request.id }, data: { status: "RETURNED" } }),
  ]);
  return { cards, cancelledOrder: order.name };
}

/** Recent vault shipments for the customer service page, newest first. */
export async function recentShipments(db: Db, shop: string, take = 40) {
  const requests = await db.shipRequest.findMany({
    where: { shop, status: { in: ["PENDING", "PAID"] } },
    orderBy: { createdAt: "desc" },
    take,
    include: { pulls: { select: { orderName: true, customerId: true } } },
  });
  // How many more cards each customer has waiting in the vault (for "Add Vault Cards").
  const waiting = new Map<string, number>();
  for (const customerId of new Set(requests.map((r) => r.customerId).filter((c): c is string => !!c))) {
    waiting.set(customerId, (await vaultedPulls(db, shop, { customerId })).filter((p) => p.shipRequest?.status !== "PENDING").length);
  }
  return requests.map((r) => ({ ...r, vaultWaiting: r.customerId ? (waiting.get(r.customerId) ?? 0) : 0 }));
}

async function orderCountry(admin: AdminApiContext, orderId: string) {
  const data = await gql(admin, `#graphql
    query VaultOrderCountry($id: ID!) { order(id: $id) { shippingAddress { countryCodeV2 } billingAddress { countryCodeV2 } } }`, { id: orderId });
  const o = data.order as { shippingAddress: { countryCodeV2: string } | null; billingAddress: { countryCodeV2: string } | null } | null;
  return o?.shippingAddress?.countryCodeV2 ?? o?.billingAddress?.countryCodeV2 ?? null;
}

async function orderEmail(admin: AdminApiContext, orderId: string) {
  const data = await gql(admin, `#graphql
    query VaultOrderEmail($id: ID!) { order(id: $id) { email } }`, { id: orderId });
  return (data.order?.email as string | null) ?? null;
}

let currency: string | null = null;
async function shopCurrency(admin: AdminApiContext) {
  if (!currency) {
    const data = await gql(admin, `#graphql
    query VaultCurrency { shop { currencyCode } }`);
    currency = data.shop.currencyCode as string;
  }
  return currency;
}

/** Vaulted cards are held this long (see the Cancellation Policy). */
export const HOLD_DAYS = 365;
/** Customers are reminded this long before the holding period ends. */
const REMIND_DAYS_BEFORE = 30;
export const VAULT_REMINDER_TAG = "vault-reminder";
export const VAULT_REMINDER_METRIC = "Vault Reminder";

/**
 * Reminds each customer once their oldest vaulted cards are a month from the end of the holding
 * period: tags their latest pack order (for a Shopify Flow trigger) and, when a Klaviyo key is
 * set, sends a "Vault Reminder" event with the card count and the date to ship by.
 */
export async function sendVaultReminders(db: Db, adminFor: (shop: string) => Promise<AdminApiContext>, now = new Date()) {
  const cutoff = new Date(now.getTime() - (HOLD_DAYS - REMIND_DAYS_BEFORE) * 86_400_000);
  const due = await db.pull.findMany({
    where: {
      status: "REVEALED",
      remindedAt: null,
      createdAt: { lt: cutoff },
      OR: [{ shipRequestId: null }, { shipRequest: { status: { not: "PENDING" } } }],
    },
    include: { slot: { include: { card: true } } },
    take: 500,
  });
  if (due.length === 0) return 0;
  const vaultOrders = new Set(
    (
      await db.packOrder.findMany({ where: { orderId: { in: [...new Set(due.map((p) => p.orderId))] }, vault: true }, select: { orderId: true } })
    ).map((o) => o.orderId),
  );
  const groups = new Map<string, typeof due>();
  for (const p of due.filter((p) => vaultOrders.has(p.orderId))) {
    const key = `${p.shop}|${p.customerId ?? p.orderId}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  let sent = 0;
  for (const pulls of groups.values()) {
    const { shop, customerId } = pulls[0];
    try {
      const admin = await adminFor(shop);
      const oldest = pulls.reduce((a, p) => (p.createdAt < a ? p.createdAt : a), pulls[0].createdAt);
      const holdUntil = new Date(oldest.getTime() + HOLD_DAYS * 86_400_000);
      // Tag their latest pack order (a Shopify Flow "Order tags added" trigger) and email via Klaviyo.
      const latest = pulls.reduce((a, p) => (p.createdAt > a.createdAt ? p : a), pulls[0]);
      await gql(
        admin,
        `#graphql
          mutation VaultReminderTag($id: ID!, $tags: [String!]!) {
            tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
          }`,
        { id: latest.orderId, tags: [VAULT_REMINDER_TAG] },
      );
      const email = await orderEmail(admin, latest.orderId);
      if (email) {
        await klaviyoEvent(email, VAULT_REMINDER_METRIC, {
          cards: pulls.length,
          card_titles: pulls.map((p) => p.slot.card.title),
          ship_by: holdUntil.toISOString().slice(0, 10),
          vault_url: `https://${shop}/apps/packs`,
        });
      }
      await db.pull.updateMany({ where: { id: { in: pulls.map((p) => p.id) } }, data: { remindedAt: now } });
      sent++;
    } catch (error) {
      console.error(`Vault reminder for ${customerId ?? pulls[0].orderId} failed`, error);
    }
  }
  return sent;
}

/** Sends a Klaviyo event (triggers a Klaviyo flow) when KLAVIYO_PRIVATE_KEY is set; otherwise does nothing. */
async function klaviyoEvent(email: string, metric: string, properties: Record<string, unknown>) {
  const key = process.env.KLAVIYO_PRIVATE_KEY;
  if (!key) return;
  const response = await fetch("https://a.klaviyo.com/api/events/", {
    method: "POST",
    headers: {
      Authorization: `Klaviyo-API-Key ${key}`,
      revision: "2024-10-15",
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
    },
    body: JSON.stringify({
      data: {
        type: "event",
        attributes: {
          properties,
          metric: { data: { type: "metric", attributes: { name: metric } } },
          profile: { data: { type: "profile", attributes: { email } } },
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`Klaviyo event failed: ${response.status} ${await response.text()}`);
}

/**
 * Emails customers whose local pickup order staff have tagged "pickup-ready": sends a
 * "Vault Pickup Ready" Klaviyo event once per order. Does nothing until a Klaviyo key is set.
 */
export async function notifyPickupsReady(db: Db, adminFor: (shop: string) => Promise<AdminApiContext>, now = new Date()) {
  if (!process.env.KLAVIYO_PRIVATE_KEY) return 0;
  const waiting = await db.shipRequest.findMany({
    where: { pickup: true, status: "PAID", readyAt: null, orderId: { not: null } },
    include: { pulls: { include: { slot: { include: { card: true } } } } },
    take: 100,
  });
  let sent = 0;
  for (const request of waiting) {
    try {
      const admin = await adminFor(request.shop);
      const data = await gql(admin, `#graphql
        query PickupOrder($id: ID!) { order(id: $id) { name email tags cancelledAt } }`, { id: request.orderId });
      const order = data.order as { name: string; email: string | null; tags: string[]; cancelledAt: string | null } | null;
      if (!order || order.cancelledAt || !order.tags.includes(PICKUP_READY_TAG)) continue;
      if (order.email) {
        await klaviyoEvent(order.email, PICKUP_READY_METRIC, {
          order_name: order.name,
          cards: request.pulls.length,
          card_titles: request.pulls.map((p) => p.slot.card.title),
          pickup_address: PICKUP_LOCATION.address,
          pickup_hours: PICKUP_LOCATION.hours,
          vault_url: `https://${request.shop}/apps/packs`,
        });
      }
      await db.shipRequest.update({ where: { id: request.id }, data: { readyAt: now } });
      sent++;
    } catch (error) {
      console.error(`Pickup ready email for ${request.id} failed`, error);
    }
  }
  return sent;
}

/**
 * Turns what staff typed into a Shopify customer: a customer ID or admin customer URL, or an
 * email address (found through that customer's orders, since the app can't read customers directly).
 */
export async function resolveCustomer(admin: AdminApiContext, input: string): Promise<{ customerId: string; label: string }> {
  const value = input.trim();
  const id = value.match(/Customer\/(\d+)/)?.[1] ?? value.match(/customers\/(\d+)/)?.[1] ?? (/^\d+$/.test(value) ? value : null);
  if (id) return { customerId: `gid://shopify/Customer/${id}`, label: `customer ${id}` };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) throw new PoolError(`"${value}" isn't an email address or customer ID.`);
  const data = await gql(
    admin,
    `#graphql
      query VaultCustomerByEmail($query: String!) {
        orders(first: 5, sortKey: CREATED_AT, reverse: true, query: $query) { nodes { email customer { id } } }
      }`,
    { query: `email:"${value.replace(/"/g, "")}"` },
  );
  const match = (data.orders.nodes as { email: string | null; customer: { id: string } | null }[]).find(
    (o) => o.customer && o.email?.toLowerCase() === value.toLowerCase(),
  );
  if (!match?.customer) {
    throw new PoolError(`No orders found for ${value}. Use their customer ID instead (the number at the end of their customer page URL).`);
  }
  return { customerId: match.customer.id, label: value };
}

/** Vault cards and unopened packs that would move from one customer to another. */
async function movablePulls(db: Db, shop: string, fromCustomerId: string) {
  return db.pull.findMany({
    where: {
      shop,
      customerId: fromCustomerId,
      status: { in: ["UNOPENED", "REVEALED"] },
      OR: [{ shipRequestId: null }, { shipRequest: { status: { notIn: ["PENDING", "PAID"] } } }],
    },
    select: { id: true, orderId: true, status: true },
  });
}

/**
 * Customer service: moves a customer's vault (opened cards still with us, plus unopened packs)
 * to another customer, e.g. when they bought under a different email. Cards already shipping
 * stay where they are; an open shipping invoice must be returned to the vault first.
 */
export async function moveVault(db: Db, shop: string, fromCustomerId: string, toCustomerId: string, { dryRun = false } = {}) {
  if (fromCustomerId === toCustomerId) throw new PoolError("Those are the same customer.");
  const pending = await db.shipRequest.count({ where: { shop, customerId: fromCustomerId, status: "PENDING" } });
  if (pending) throw new PoolError("That customer has an unpaid shipping invoice. Return it to the vault first, then move the vault.");
  const pulls = await movablePulls(db, shop, fromCustomerId);
  const summary = {
    cards: pulls.filter((p) => p.status === "REVEALED").length,
    unopened: pulls.filter((p) => p.status === "UNOPENED").length,
    orders: new Set(pulls.map((p) => p.orderId)).size,
  };
  if (dryRun || pulls.length === 0) return summary;
  await db.$transaction([
    db.pull.updateMany({ where: { id: { in: pulls.map((p) => p.id) } }, data: { customerId: toCustomerId } }),
    db.packOrder.updateMany({ where: { orderId: { in: [...new Set(pulls.map((p) => p.orderId))] } }, data: { customerId: toCustomerId } }),
  ]);
  console.log(`Moved vault from ${fromCustomerId} to ${toCustomerId}: ${pulls.length} pulls`);
  return summary;
}
