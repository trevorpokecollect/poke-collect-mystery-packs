// The card vault: pulled cards stay with us until the customer asks to have them shipped.
// "Ship my cards" makes one draft order for the vaulted cards (free) plus a flat shipping fee;
// paying its invoice creates a normal order that ships like any other.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { PrismaClient } from "@prisma/client";
import { gql } from "./orders.server";
import { rereserveForPulls, unreserveForPulls } from "./inventory.server";
import { pullsForViewer, PoolError, type Viewer } from "./pool.server";

export const SHIP_FEE = 8;
/** Shipping is free once a single shipment has this many cards. */
export const FREE_SHIPPING_CARDS = 25;
/** How long an unpaid shipping invoice holds the cards before they go back to the vault. */
const INVOICE_DAYS = 7;
export const VAULT_TAG = "mystery-vault-shipment";
export const VAULT_ATTRIBUTE = "_vault_request";

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
export async function requestShipment(db: Db, admin: AdminApiContext, shop: string, viewer: Viewer) {
  const inVault = await vaultedPulls(db, shop, viewer);
  const pending = inVault.find((p) => p.shipRequest?.status === "PENDING")?.shipRequest;
  if (pending?.invoiceUrl) return { invoiceUrl: pending.invoiceUrl, reused: true };

  const pulls = inVault.filter((p) => !p.shipRequestId || p.shipRequest?.status !== "PENDING");
  if (pulls.length === 0) throw new PoolError("There are no cards in your vault to ship yet.");

  const fee = shippingFeeFor(pulls.length);
  const expiresAt = new Date(Date.now() + INVOICE_DAYS * 86_400_000);
  const customerId = viewer.customerId ?? pulls.find((p) => p.customerId)?.customerId ?? null;
  const request = await db.shipRequest.create({
    data: { shop, customerId, cardCount: pulls.length, shippingFee: fee, expiresAt },
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
          tags: [VAULT_TAG],
          note: `Vault shipment: ${pulls.length} card${pulls.length === 1 ? "" : "s"} from ${[...new Set(pulls.map((p) => p.orderName))].join(", ")}`,
          customAttributes: [{ key: VAULT_ATTRIBUTE, value: request.id }],
          reserveInventoryUntil: expiresAt.toISOString(),
          shippingLine: {
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
      const admin = await adminFor(request.shop);
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
          continue;
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
        db.shipRequest.update({ where: { id: request.id }, data: { status: "EXPIRED" } }),
      ]);
    } catch (error) {
      console.error(`Expiring ship request ${request.id} failed`, error);
    }
  }
}

async function orderEmail(admin: AdminApiContext, orderId: string) {
  const data = await gql(admin, `#graphql query VaultOrderEmail($id: ID!) { order(id: $id) { email } }`, { id: orderId });
  return (data.order?.email as string | null) ?? null;
}

let currency: string | null = null;
async function shopCurrency(admin: AdminApiContext) {
  if (!currency) {
    const data = await gql(admin, `#graphql query VaultCurrency { shop { currencyCode } }`);
    currency = data.shop.currencyCode as string;
  }
  return currency;
}
