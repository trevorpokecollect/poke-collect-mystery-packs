import { createHmac, randomUUID } from "node:crypto";
import db from "../db.server";
import { entrantTotal } from "./entries/ledger.server";
import { parseSettings } from "./settings";

// Outbound webhooks to the URL set in Campaign.settings.webhookUrl. Each POST is
// signed: X-Giveaway-Signature = "sha256=" + hex HMAC-SHA256(raw body,
// OUTBOUND_WEBHOOK_SECRET). Delivery is best effort (one try, short timeout)
// and never throws, so callers can fire and forget. Callers pass only ids; the
// entrant/draw details are loaded here, off the request path.

export type OutboundEvent =
  | "entrant.created"
  | "entrant.activated"
  | "purchase.entries"
  | "draw.completed";

const TIMEOUT_MS = 4000;

export function signBody(body: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function details(data: Record<string, unknown>) {
  if (typeof data.entrantId === "string") {
    const e = await db.entrant.findUnique({ where: { id: data.entrantId } });
    if (!e) return {};
    return {
      entrant: {
        id: e.id,
        email: e.email,
        name: e.name,
        status: e.status,
        referralCode: e.referralCode,
        marketingConsent: e.marketingConsent,
        shopifyCustomerId: e.shopifyCustomerId,
        totalEntries: await entrantTotal(e.id),
      },
    };
  }
  if (typeof data.drawId === "string") {
    const d = await db.draw.findUnique({
      where: { id: data.drawId },
      include: { winners: { include: { entrant: true } } },
    });
    if (!d) return {};
    return {
      draw: {
        id: d.id,
        seed: d.seed,
        snapshotHash: d.snapshotHash,
        totalEntries: d.totalEntries,
        eligibleCount: d.eligibleCount,
        winners: d.winners.map((w) => ({
          position: w.position,
          entrantId: w.entrantId,
          email: w.entrant.email,
          name: w.entrant.name,
        })),
      },
    };
  }
  return {};
}

async function deliver(
  campaignId: string,
  event: OutboundEvent,
  data: Record<string, unknown>,
) {
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, shop: true, slug: true, title: true, settings: true },
  });
  if (!campaign) return;
  const url = parseSettings(campaign.settings).webhookUrl;
  if (!url) return;
  const secret = process.env.OUTBOUND_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[webhook-out] OUTBOUND_WEBHOOK_SECRET not set; skipped");
    return;
  }
  const id = randomUUID();
  const body = JSON.stringify({
    id,
    event,
    createdAt: new Date().toISOString(),
    shop: campaign.shop,
    campaign: { id: campaign.id, slug: campaign.slug, title: campaign.title },
    data: { ...data, ...(await details(data)) },
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Cardbit-Giveaways/1.0",
      "X-Giveaway-Event": event,
      "X-Giveaway-Delivery": id,
      "X-Giveaway-Signature": signBody(body, secret),
    },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) console.warn(`[webhook-out] ${event} -> ${res.status}`);
}

/** Fire-and-forget: returns immediately and swallows every error. */
export function emitWebhook(
  campaignId: string,
  event: OutboundEvent,
  data: Record<string, unknown>,
) {
  deliver(campaignId, event, data).catch((err) =>
    console.warn(`[webhook-out] ${event} failed: ${(err as Error).message}`),
  );
}
