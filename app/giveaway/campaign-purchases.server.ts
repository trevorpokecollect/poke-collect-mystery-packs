import db from "../db.server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { topups } from "../lib/cardbit-topups.server";
import { paidEntries } from "./rules";
import {
  processOrder,
  type OrderWebhookPayload,
} from "./legacy/app/lib/entries/orders.server";
import type { EstimateLine } from "./legacy/app/lib/entries/estimate";
export async function campaignOrders(
  store: string,
  topic: string,
  payload: OrderWebhookPayload & { test?: boolean; financial_status?: string },
) {
  if (
    store !== shop ||
    payload.test ||
    !(await db.campaign.findFirst({
      where: { shop, status: "ACTIVE" },
      select: { id: true },
    }))
  )
    return;
  if (
    !["paid", "partially_refunded", "refunded", "voided"].includes(
      String(payload.financial_status),
    ) &&
    topic !== "ORDERS_CANCELLED"
  )
    return;
  await processOrder(shop, payload, {
    cancelled: topic === "ORDERS_CANCELLED",
  });
}
export async function dailyEstimate(
  store: string,
  slug: string | null | undefined,
  lines: EstimateLine[],
) {
  if (
    store !== shop ||
    (slug && !["latest", "daily-giveaway", "daily-cardbits"].includes(slug))
  )
    return null;
  const config = await db.cardbitGiveawayConfig.findUnique({ where: { shop } });
  if (!config?.enabled) return null;
  const value = lines.reduce((n, l) => {
    const id = String(l.variantId ?? "")
      .split("/")
      .at(-1);
    const tier = topups.find((t) => t.variant === id);
    return (
      n +
      (tier &&
      Number.isSafeInteger(l.quantity) &&
      l.quantity > 0 &&
      l.price === tier.amount
        ? paidEntries(tier.amount * l.quantity)
        : 0)
    );
  }, 0);
  return value
    ? {
        entries: value,
        giveaway: { slug: "daily-cardbits", title: "Daily Cardbit giveaway" },
      }
    : null;
}
