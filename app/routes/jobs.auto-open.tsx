import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { autoOpenDue, ordersReadyToFinalize } from "../lib/pool.server";
import { finalizeOrder, fulfillMissingVaultPackLines, noteMissingVaultPulls } from "../lib/orders.server";
import { expireShipments, notifyPickupsReady, sendVaultReminders } from "../lib/vault.server";

// Called on a schedule (Railway cron): opens packs past their window and retries
// any order that is ready to ship but wasn't finalized yet.
export const action = async ({ request }: ActionFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  await autoOpenDue(db);
  const ready = await ordersReadyToFinalize(db);
  const results = [];
  for (const { orderId, shop } of ready) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      await finalizeOrder(db, admin, orderId);
      results.push({ orderId, ok: true });
    } catch (error) {
      console.error(`Finalizing ${orderId} failed`, error);
      results.push({ orderId, ok: false });
    }
  }
  // Unpaid "ship my cards" invoices past their window: cards go back to the vault.
  await expireShipments(db, async (shop) => (await unauthenticated.admin(shop)).admin);
  await noteMissingVaultPulls(db, async (shop) => (await unauthenticated.admin(shop)).admin);
  await fulfillMissingVaultPackLines(db, async (shop) => (await unauthenticated.admin(shop)).admin);
  // Cards a month from the end of their 12-month vault hold: remind the customer once.
  await sendVaultReminders(db, async (shop) => (await unauthenticated.admin(shop)).admin);
  // Local pickup orders staff tagged "pickup-ready": email the customer once (Klaviyo).
  await notifyPickupsReady(db, async (shop) => (await unauthenticated.admin(shop)).admin);
  return Response.json({ finalized: results });
};
