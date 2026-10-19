import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { PoolError, revealPull } from "../lib/pool.server";
import { finalizeOrder } from "../lib/orders.server";
import { json, proxyContext } from "../lib/proxy.server";
import { cardLanguages } from "../lib/card-language.server";

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
    // The language picks the English or Japanese card back shown before a big hit turns over.
    const languageOf = await cardLanguages(admin, result.cards.concat(result.card).map((c) => c.productId));
    const view = (c: { title: string; tier: string; imageUrl: string | null; productId: string }) => ({
      title: c.title,
      tier: c.tier,
      imageUrl: c.imageUrl,
      language: languageOf(c.productId),
    });
    return json({
      // Best card (single-card packs: the card). Multi-card packs also get every card, best last.
      card: view(result.card),
      cards: result.cards.map(view),
    });
  } catch (error) {
    if (error instanceof PoolError) return json({ error: error.message }, 404);
    throw error;
  }
};
