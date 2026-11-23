import type { Campaign } from "@prisma/client";
import db from "../db.server";
import { addDays, periodFor, planQueue, type Period } from "./daily";
import { parseSettings } from "./settings";
import { bundleTitle, type BundlePart } from "./bundles";

// The daily prize queue: products the merchant lined up, used one per day ahead of the
// automatic pick (see ensurePrize in daily.server.ts).

export const queueItems = (campaignId: string) =>
  db.dailyQueueItem.findMany({
    where: { campaignId, usedAt: null },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });

/** Queued items in the order to try for `period`: the one pinned to it first, then the rest. */
export async function queueFor(campaignId: string, period: Period) {
  const items = await queueItems(campaignId);
  const pinned = items.filter((i) => i.pinnedDate === period.key);
  const loose = items.filter((i) => !i.pinnedDate || i.pinnedDate < period.key);
  return [...pinned, ...loose];
}

export async function addToQueue(
  campaignId: string,
  products: { productId: string; title: string; imageUrl: string | null }[],
) {
  const last = await db.dailyQueueItem.findFirst({
    where: { campaignId, usedAt: null },
    orderBy: { position: "desc" },
  });
  let position = (last?.position ?? 0) + 1;
  await db.dailyQueueItem.createMany({
    data: products.map((p) => ({ campaignId, ...p, position: position++ })),
  });
}

/** Lines up a bundle (several products, or several of one) as one upcoming prize. */
export async function addBundleToQueue(
  campaignId: string,
  parts: BundlePart[],
) {
  const last = await db.dailyQueueItem.findFirst({
    where: { campaignId, usedAt: null },
    orderBy: { position: "desc" },
  });
  await db.dailyQueueItem.create({
    data: {
      campaignId,
      productId: parts[0].productId,
      title: bundleTitle(parts).slice(0, 300),
      imageUrl: parts[0].imageUrl,
      bundle: parts as unknown as object,
      position: (last?.position ?? 0) + 1,
    },
  });
}

/** Moves an item one place up or down among the unused ones. */
export async function moveQueueItem(
  campaignId: string,
  id: string,
  dir: "up" | "down",
) {
  const items = await queueItems(campaignId);
  const i = items.findIndex((x) => x.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  await db.$transaction(
    items.map((x, n) =>
      db.dailyQueueItem.update({
        where: { id: x.id },
        data: { position: n + 1 },
      }),
    ),
  );
}

export const removeQueueItem = (campaignId: string, id: string) =>
  db.dailyQueueItem.deleteMany({ where: { campaignId, id, usedAt: null } });

export const pinQueueItem = (
  campaignId: string,
  id: string,
  date: string | null,
) =>
  db.dailyQueueItem.updateMany({
    where: { campaignId, id, usedAt: null },
    data: {
      pinnedDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    },
  });

/** The planned prize for each of the next `days` draws, starting with tomorrow's. */
export async function upcomingPlan(campaign: Campaign, days = 7) {
  const cfg = parseSettings(campaign.settings).daily;
  const today = periodFor(new Date(), campaign.timezone, cfg.drawTime);
  const items = await queueItems(campaign.id);
  return {
    items,
    plan: planQueue(items, addDays(today.key, 1), days),
  };
}
