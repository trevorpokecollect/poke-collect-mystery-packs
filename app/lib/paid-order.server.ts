// The card for every pack is decided here, server-side, the moment payment clears.
// Called from orders/paid, and from orders/create for orders that are created already paid
// (Shopify sends no orders/paid for those). Drawing is idempotent, so both firing is safe.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { drawForOrder } from "./pool.server";
import { fulfillVaultPackLines, fulfillWholeOrder, holdOrder, setOpenLinkMetafield, tagOrder } from "./orders.server";
import { packsPageUrl, storefrontBase } from "./links.server";
import { checkTopTierGone } from "./top-tier-alert.server";
import { markShipmentPaid, VAULT_ATTRIBUTE } from "./vault.server";
import { completeSale, MARKET_ATTRIBUTE, METRICS, notify } from "./market.server";
import { settleCreditCodes } from "./credit.server";

export interface OrderPayload {
  admin_graphql_api_id: string;
  name: string;
  financial_status?: string | null;
  checkout_token?: string | null;
  customer?: { admin_graphql_api_id?: string } | null;
  note_attributes?: { name: string; value: string }[] | null;
  discount_codes?: { code: string; amount: string }[] | null;
  shipping_address?: { country_code?: string | null } | null;
  line_items: {
    admin_graphql_api_id: string;
    variant_id: number | null;
    quantity: number;
  }[];
}

export async function handlePaidOrder(shop: string, admin: AdminApiContext | undefined, order: OrderPayload) {
  // Any order can use a Vault Credit code: record it and give back what the cart didn't use.
  await settleCreditCodes(db, order).catch((error) => console.error(`Settling Vault Credit codes on ${order.name} failed`, error));

  // A paid "ship my cards" invoice: its vaulted cards now ship on this order.
  const vaultRequest = order.note_attributes?.find((a) => a.name === VAULT_ATTRIBUTE)?.value;
  if (vaultRequest) {
    await markShipmentPaid(db, vaultRequest, order.admin_graphql_api_id);
    // The $5 vault rate is US only; flag shipments to other countries for the merchant.
    const country = order.shipping_address?.country_code;
    if (admin && country && country !== "US") {
      await tagOrder(admin, order.admin_graphql_api_id, ["vault-international-review"]).catch((e) => console.error("Tag failed", e));
    }
    return;
  }

  // A paid Vault Marketplace purchase: the card moves to the buyer's vault.
  const marketListing = order.note_attributes?.find((a) => a.name === MARKET_ATTRIBUTE)?.value;
  if (marketListing) {
    const sold = await completeSale(db, marketListing, order.admin_graphql_api_id, order.name);
    // The checkout's "Vault Card" variant is kept, so the order shows the card's picture in the admin.
    const paidListing = await db.listing.findUnique({ where: { id: marketListing }, select: { status: true, payoutStatus: true } });
    // The card is already in the buyer's vault: nothing to ship, so the order is fulfilled now.
    // A flagged sale (the card couldn't move) stays open for staff to refund.
    if (admin && paidListing?.status === "SOLD" && paidListing.payoutStatus !== "FLAGGED") {
      await fulfillWholeOrder(admin, order.admin_graphql_api_id).catch((e) => console.error("Fulfilling market order failed", e));
    }
    if (sold) await notify(admin, sold.sellerCustomerId, METRICS.cardSold, { price: Number(sold.price).toFixed(2), payoutAmount: Number(sold.payoutAmount).toFixed(2) });
    return;
  }

  const result = await drawForOrder(db, {
    shop,
    orderId: order.admin_graphql_api_id,
    orderName: order.name,
    customerId: order.customer?.admin_graphql_api_id ?? null,
    checkoutToken: order.checkout_token ?? null,
    lines: order.line_items
      .filter((l) => l.variant_id)
      .map((l) => ({
        lineItemId: l.admin_graphql_api_id,
        variantId: `gid://shopify/ProductVariant/${l.variant_id}`,
        quantity: l.quantity,
      })),
  });

  if (!result.packOrder || !admin) return;

  if (!result.packOrder.held) {
    // Vault orders ship anything else on the order right away; the cards stay in the vault.
    if (!result.packOrder.vault) await holdOrder(admin, order.admin_graphql_api_id);
    await db.packOrder.update({
      where: { orderId: order.admin_graphql_api_id },
      data: { held: true },
    });
    await setOpenLinkMetafield(
      admin,
      order.admin_graphql_api_id,
      packsPageUrl(await storefrontBase(admin, shop), result.packOrder.openToken),
    );
  }

  if (result.packOrder.vault) {
    await fulfillVaultPackLines(db, admin, order.admin_graphql_api_id).catch((error) =>
      console.error(`Fulfilling pack lines on ${order.name} failed`, error),
    );
  }

  if (result.pulls.length > 0) {
    await checkTopTierGone(db, admin, shop, result.pulls.map((p) => p.seriesId), order.admin_graphql_api_id).catch((error) =>
      console.error("Top tier check failed", error),
    );
  }

  if (result.shortfall.length > 0) {
    // More packs sold than cards left (should not happen while pack inventory matches the pool).
    console.error(`Order ${order.name}: series sold out before all packs were drawn`, result.shortfall);
    await tagOrder(admin, order.admin_graphql_api_id, ["mystery-pack-sold-out-refund-needed"]);
  }
}

