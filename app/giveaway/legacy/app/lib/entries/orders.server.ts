import { shipsOutsideUs } from "../us-only";
import { randomBytes } from "node:crypto";
import type { Campaign } from "@prisma/client";
import db from "../../db.server";
import { normalizeEmail } from "../bot/email";
import { award } from "./ledger.server";
import { emitWebhook } from "../webhook-out.server";
import { parseSettings } from "../settings";
import { purchaseRulesSchema, scoreOrder, type ScorableOrder } from "./rules";

/** Subset of the Shopify `orders/*` webhook payload that we use. */
export interface OrderWebhookPayload {
  id: number | string;
  name?: string;
  email?: string | null;
  contact_email?: string | null;
  created_at: string;
  cancelled_at?: string | null;
  source_name?: string;
  subtotal_price?: string;
  total_price?: string;
  payment_gateway_names?: string[];
  customer?: {
    id?: number | string;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  shipping_address?: { country_code?: string | null } | null;
  billing_address?: {
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  line_items: {
    product_id: number | string | null;
    variant_id: number | string | null;
    quantity: number;
    current_quantity?: number;
    price: string;
  }[];
}

/** When the order was placed, as recorded in its order log (older logs don't have it). */
export function orderPlacedAt(breakdown: unknown) {
  const v = (breakdown as { placedAt?: unknown } | null)?.placedAt;
  return typeof v === "string" ? new Date(v) : null;
}

/** The buyer's name from the order (customer, else billing address), for winner display. */
export function orderBuyerName(p: OrderWebhookPayload) {
  for (const n of [p.customer, p.billing_address]) {
    const full = [n?.first_name, n?.last_name]
      .map((x) => x?.trim())
      .filter(Boolean)
      .join(" ");
    if (full) return full;
  }
  return null;
}

const gid = (type: string, id: number | string | null) =>
  id ? `gid://shopify/${type}/${id}` : "";

export function toScorableOrder(p: OrderWebhookPayload): ScorableOrder {
  return {
    createdAt: new Date(p.created_at),
    sourceName: p.source_name ?? "web",
    subtotal: Number(p.subtotal_price ?? 0),
    total: Number(p.total_price ?? 0),
    // The webhook doesn't itemize gift card amounts; refine via the Admin API if needed.
    giftCardAmount: 0,
    lines: p.line_items.map((l) => ({
      productId: gid("Product", l.product_id),
      variantId: gid("ProductVariant", l.variant_id),
      quantity: l.current_quantity ?? l.quantity,
      unitPrice: Number(l.price),
    })),
  };
}

/**
 * When orders start counting: the start date, or for a giveaway opened with "Go live" and no
 * start date, when it was created (Go live now records a start date). Updates Shopify sends
 * for older orders (fulfilment, tags, edits) never earn entries.
 */
export const ordersCountFrom = (c: Pick<Campaign, "startsAt" | "createdAt">) =>
  c.startsAt ?? c.createdAt;

async function liveCampaigns(shop: string, at: Date) {
  const campaigns = await db.campaign.findMany({
    where: { shop, status: "ACTIVE" },
  });
  return campaigns.filter(
    (c) =>
      c.purchaseRules &&
      ordersCountFrom(c) <= at &&
      (!c.endsAt || c.endsAt >= at),
  );
}

async function netOrderEntries(orderLogId: string) {
  const { _sum } = await db.entryEvent.aggregate({
    where: { orderLogId },
    _sum: { entries: true },
  });
  return _sum.entries ?? 0;
}

async function findOrCreateEntrant(
  campaign: Campaign,
  email: string,
  customerId: string | null,
  auto: boolean,
  name: string | null,
) {
  const emailNormalized = normalizeEmail(email);
  const existing = await db.entrant.findUnique({
    where: {
      campaignId_emailNormalized: { campaignId: campaign.id, emailNormalized },
    },
  });
  // Buyers who signed up without a name get the one from their order.
  if (existing && !existing.name?.trim() && name)
    return db.entrant.update({ where: { id: existing.id }, data: { name } });
  if (existing || !auto) return existing;
  // A paid order is strong proof of a real person, so these start ACTIVE.
  const created = await db.entrant.create({
    data: {
      campaignId: campaign.id,
      email,
      emailNormalized,
      name,
      shopifyCustomerId: customerId,
      status: "ACTIVE",
      verifiedAt: new Date(),
      referralCode: randomBytes(5).toString("base64url"),
    },
  });
  emitWebhook(campaign.id, "entrant.created", {
    entrantId: created.id,
    status: "ACTIVE",
  });
  return created;
}

/** Handles orders/create, orders/updated (edits) and orders/cancelled. Idempotent. */
export async function processOrder(
  shop: string,
  payload: OrderWebhookPayload,
  opts: { cancelled?: boolean } = {},
) {
  const order = toScorableOrder(payload);
  const email = payload.email || payload.contact_email;
  const shopifyOrderId = String(payload.id);
  const cancelled = opts.cancelled || !!payload.cancelled_at;
  // US-only giveaways: an order shipping abroad earns nothing and signs nobody up.
  const abroad = shipsOutsideUs(payload.shipping_address);

  for (const campaign of await liveCampaigns(shop, order.createdAt)) {
    const parsed = purchaseRulesSchema.safeParse(campaign.purchaseRules);
    if (!parsed.success) continue;
    const rules = parsed.data;
    const excluded = abroad && parseSettings(campaign.settings).usOnly;
    const log = await db.orderLog.findUnique({
      where: {
        campaignId_shopifyOrderId: { campaignId: campaign.id, shopifyOrderId },
      },
    });

    const entrant = email
      ? await findOrCreateEntrant(
          campaign,
          email,
          payload.customer?.id ? gid("Customer", payload.customer.id) : null,
          false, // Entry requires the customer to opt in and tap to enter.
          orderBuyerName(payload),
        )
      : null;

    if (!entrant) {
      if (!log) {
        await db.orderLog.create({
          data: {
            campaignId: campaign.id,
            shopifyOrderId,
            orderName: payload.name,
            email,
            status: "NO_USER",
          },
        });
      }
      continue;
    }

    const breakdown = cancelled || excluded ? null : scoreOrder(rules, order);
    const target = breakdown?.entries ?? 0;
    const orderLog =
      log ??
      (await db.orderLog.create({
        data: {
          campaignId: campaign.id,
          shopifyOrderId,
          orderName: payload.name,
          email,
          status: "NO_ENTRIES",
        },
      }));

    // An order disqualified by hand in the admin stays at zero, whatever Shopify sends later.
    if (
      log &&
      (await db.entryEvent.count({
        where: { orderLogId: log.id, dedupeKey: { startsWith: "void:" } },
      }))
    )
      continue;

    // Bring the ledger for this order to exactly `target` entries.
    const current = await netOrderEntries(orderLog.id);
    const delta = target - current;
    if (delta !== 0) {
      await award({
        campaignId: campaign.id,
        entrantId: entrant.id,
        entries: delta,
        source: delta > 0 && current === 0 ? "PURCHASE" : "ROLLBACK",
        orderLogId: orderLog.id,
        // Daily draws count an order on the day it was placed, not when Shopify sent the update.
        createdAt: parseSettings(campaign.settings).daily.enabled
          ? order.createdAt
          : undefined,
        note: cancelled
          ? "order cancelled"
          : current === 0
            ? undefined
            : "order edited",
      });
      emitWebhook(campaign.id, "purchase.entries", {
        entrantId: entrant.id,
        orderId: shopifyOrderId,
        orderName: payload.name,
        entries: delta,
      });
    }

    await db.orderLog.update({
      where: { id: orderLog.id },
      data: {
        entries: target,
        // Order amounts ride along so analytics can report revenue.
        breakdown: (breakdown
          ? {
              ...breakdown,
              subtotal: order.subtotal,
              total: order.total,
              placedAt: order.createdAt.toISOString(),
            }
          : {
              reason: cancelled ? "cancelled" : "ships outside the US",
              placedAt: order.createdAt.toISOString(),
            }) as object,
        status: cancelled
          ? "ROLLED_BACK_CANCELLED"
          : current > 0 && delta !== 0
            ? "ROLLED_BACK_EDIT"
            : target > 0
              ? "ENTRIES"
              : "NO_ENTRIES",
      },
    });
  }
}

const ORDER_DATES = `#graphql
  query OrderDates($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Order { id createdAt } }
  }`;

interface GraphqlClient {
  graphql: (
    query: string,
    opts?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

/**
 * Takes back entries from orders placed before the giveaway started (they came in through
 * Shopify updates to older orders). Each removal is a rollback with a note, and the order log
 * shows it. Safe to run again.
 */
export async function removePreStartOrderEntries(
  campaign: Campaign,
  admin: GraphqlClient,
) {
  const cutoff = ordersCountFrom(campaign);
  const logs = await db.orderLog.findMany({
    where: { campaignId: campaign.id, entries: { not: 0 } },
    include: {
      events: { select: { entrantId: true, entries: true, createdAt: true } },
    },
  });
  let orders = 0;
  let entries = 0;
  for (let i = 0; i < logs.length; i += 100) {
    const batch = logs.slice(i, i + 100);
    const res = await admin.graphql(ORDER_DATES, {
      variables: {
        ids: batch.map((l) => `gid://shopify/Order/${l.shopifyOrderId}`),
      },
    });
    const body = (await res.json()) as {
      data?: { nodes: ({ id: string; createdAt: string } | null)[] };
    };
    const placed = new Map(
      (body.data?.nodes ?? []).flatMap((n) =>
        n ? [[n.id.split("/").pop()!, new Date(n.createdAt)] as const] : [],
      ),
    );
    for (const log of batch) {
      const at = placed.get(log.shopifyOrderId);
      if (!at || at >= cutoff) continue;
      const net = log.events.reduce((s, e) => s + e.entries, 0);
      const entrantId = log.events[0]?.entrantId;
      if (net > 0 && entrantId) {
        await award({
          campaignId: campaign.id,
          entrantId,
          entries: -net,
          source: "ROLLBACK",
          orderLogId: log.id,
          note: "order placed before the giveaway started",
          // Same draw day as the entries it takes back, so a daily draw nets to zero there.
          createdAt: new Date(
            Math.max(...log.events.map((e) => e.createdAt.getTime())) + 1,
          ),
        });
        entries += net;
      }
      await db.orderLog.update({
        where: { id: log.id },
        data: {
          entries: 0,
          status: "NO_ENTRIES",
          breakdown: {
            reason: "placed before the giveaway started",
            placedAt: at.toISOString(),
          },
        },
      });
      orders++;
    }
  }
  return { orders, entries };
}
