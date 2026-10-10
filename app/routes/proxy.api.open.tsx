import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { PoolError, revealPull } from "../lib/pool.server";
import { finalizeOrder } from "../lib/orders.server";
import { json, proxyContext } from "../lib/proxy.server";

// Reveals a pack. The card was decided at payment; this only marks it opened and returns it.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, viewer, admin } = await proxyContext(request);
  if (!viewer) return json({ error: "Log in to open your packs." }, 401);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { packId } = (await request.json().catch(() => ({}))) as { packId?: string };
  if (!packId) return json({ error: "Missing pack." }, 400);

  try {
    const result = await revealPull(db, shop, packId, viewer);
    if (result.orderReady && admin) {
      // Don't make the customer wait on Shopify; the auto-open job retries failures.
      finalizeOrder(db, admin, result.orderId).catch((error) =>
        console.error(`Finalizing ${result.orderId} failed`, error),
      );
    }
    return json({
      card: {
        title: result.card.title,
        tier: result.card.tier,
        imageUrl: result.card.imageUrl,
        marketValue: result.card.marketValue.toString(),
      },
    });
  } catch (error) {
    if (error instanceof PoolError) return json({ error: error.message }, 404);
    throw error;
  }
};
