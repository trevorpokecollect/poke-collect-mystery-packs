import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { voidPulls } from "../lib/pool.server";
import { releaseUnneeded } from "../lib/inventory.server";
import { syncPackStock } from "../lib/series.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload } = await authenticate.webhook(request);
  const orderId = (payload as { admin_graphql_api_id: string }).admin_graphql_api_id;
  const voided = await voidPulls(db, orderId);
  // Cards from voided packs go back on sale (auto-built pools reserve real inventory).
  if (admin) {
    for (const seriesId of new Set(voided.map((p) => p.seriesId))) {
      await releaseUnneeded(db, admin, seriesId);
      // A cancelled pack's card leaves the pool; keep pack stock equal to the cards left.
      await syncPackStock(admin, seriesId);
    }
  }
  return new Response();
};
