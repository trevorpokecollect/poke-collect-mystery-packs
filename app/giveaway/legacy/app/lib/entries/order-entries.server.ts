import db from "../../db.server";
import { estimateEntries, type EstimateLine } from "./estimate";
import { livePurchaseCampaigns } from "./estimate.server";

// What the thank-you and order status blocks show: entries this order earned, per giveaway.

export type OrderEntriesResponse =
  | { status: "none" }
  // The orders/create webhook hasn't been processed yet, so these are estimates.
  | { status: "pending"; giveaways: { title: string; entries: number }[] }
  | { status: "earned"; giveaways: { title: string; entries: number }[] };

const PENDING_MS = 15 * 60 * 1000;

/** Numeric order id from an Order or OrderIdentity gid (the thank-you page gives the latter). */
export const orderIdFromGid = (gid: string | null | undefined) =>
  /(\d+)\s*$/.exec(gid ?? "")?.[1] ?? null;

export async function orderEntries(input: {
  shop: string;
  orderGid: string | null | undefined;
  /** Signed-in customer (gid) from the customer account session token. */
  customerId?: string | null;
  lines: EstimateLine[];
  /** Looks up when the order was placed; only called when no webhook has been logged. */
  placedAt?: () => Promise<Date | null>;
}): Promise<OrderEntriesResponse> {
  const orderId = orderIdFromGid(input.orderGid);
  if (!orderId) return { status: "none" };

  const logs = await db.orderLog.findMany({
    where: { shopifyOrderId: orderId, campaign: { shop: input.shop } },
    include: {
      campaign: { select: { title: true } },
      events: {
        select: {
          entries: true,
          entrant: { select: { shopifyCustomerId: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (logs.length) {
    // On the order status page, don't show entries tied to another customer's account.
    const owned = (l: (typeof logs)[number]) =>
      !input.customerId ||
      l.events.every(
        (e) =>
          !e.entrant.shopifyCustomerId ||
          e.entrant.shopifyCustomerId === input.customerId,
      );
    const giveaways = logs
      .filter(owned)
      .map((l) => ({
        title: l.campaign.title,
        entries: l.events.reduce((s, e) => s + e.entries, 0),
      }))
      .filter((g) => g.entries > 0);
    return giveaways.length
      ? { status: "earned", giveaways }
      : { status: "none" };
  }

  // Webhooks land within seconds, so an older order with no log simply earned nothing.
  const placed = input.placedAt ? await input.placedAt() : null;
  if (placed && Date.now() - placed.getTime() > PENDING_MS)
    return { status: "none" };
  const giveaways = (await livePurchaseCampaigns(input.shop))
    .map(({ campaign, rules }) => ({
      title: campaign.title,
      entries: estimateEntries(rules, input.lines),
    }))
    .filter((g) => g.entries > 0);
  return giveaways.length
    ? { status: "pending", giveaways }
    : { status: "none" };
}
