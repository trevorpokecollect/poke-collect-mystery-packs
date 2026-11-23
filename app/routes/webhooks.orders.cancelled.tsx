import {campaignOrders} from "../giveaway/campaign-purchases.server";
import type {OrderWebhookPayload} from "../giveaway/legacy/app/lib/entries/orders.server";
import { reverseReferralOrder } from "../giveaway/purchases.server";
import { enabled } from "../workspace/mode.server";
import { reviewFunding } from "../lib/cardbits.server";
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { voidPulls } from "../lib/pool.server";
import { flagMarketOrder } from "../lib/market.server";
import { refundCreditCodes } from "../lib/credit.server";
import { releaseUnneeded } from "../lib/inventory.server";
import { syncPackStock } from "../lib/series.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload, shop } = await authenticate.webhook(request);
  const orderId = (payload as { admin_graphql_api_id: string }).admin_graphql_api_id;
  if(enabled(shop)) await reverseReferralOrder(db,shop,orderId);
  await reviewFunding(db,shop,orderId,admin);
  // A cancelled Vault Marketplace purchase: hold the seller's credit for staff.
  await flagMarketOrder(db, orderId, "The buyer's order was cancelled.");
  // A cancelled order paid partly with a Vault Credit code: that credit goes back to the balance.
  await refundCreditCodes(db, orderId);
  const voided = await voidPulls(db, orderId);
  // Cards from voided packs go back on sale (auto-built pools reserve real inventory).
  if (admin) {
    for (const seriesId of new Set(voided.map((p) => p.seriesId))) {
      await releaseUnneeded(db, admin, seriesId);
      // A cancelled pack's card leaves the pool; keep pack stock equal to the cards left.
      await syncPackStock(admin, seriesId);
    }
  }
  if(enabled(shop)) await campaignOrders(shop,"ORDERS_CANCELLED",payload as OrderWebhookPayload);
  return new Response();
};
