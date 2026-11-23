import {dailyEstimate} from "../../../../campaign-purchases.server";
import db from "../../db.server";
import { estimateEntries, type EstimateLine } from "./estimate";
import { purchaseRulesSchema } from "./rules";
import { liveCampaignShared } from "../storefront/live-campaign.server";

/** Open giveaways that award purchase entries, newest first. */
export async function livePurchaseCampaigns(shop: string, now = new Date()) {
  const campaigns = await db.campaign.findMany({
    where: {
      shop,
      status: "ACTIVE",
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
    },
    orderBy: { createdAt: "desc" },
  });
  return campaigns.flatMap((c) => {
    const parsed = purchaseRulesSchema.safeParse(c.purchaseRules ?? undefined);
    return c.purchaseRules && parsed.success && parsed.data.enabled
      ? [{ campaign: c, rules: parsed.data }]
      : [];
  });
}

/**
 * Estimated entries for a basket in one giveaway: the one named by `slug` (link name or
 * title, as the widget block takes it), or else the newest open giveaway with purchase entries.
 */
export async function estimateForShop(
  shop: string,
  slug: string | null | undefined,
  lines: EstimateLine[],
) {
  const daily=await dailyEstimate(shop,slug,lines);
  if(daily)return daily;
  let target: Awaited<ReturnType<typeof livePurchaseCampaigns>>[number] | null =
    null;
  if (slug?.trim() && slug.trim() !== "latest") {
    const campaign = await liveCampaignShared(shop, slug);
    const parsed = purchaseRulesSchema.safeParse(
      campaign?.purchaseRules ?? undefined,
    );
    if (campaign?.purchaseRules && parsed.success)
      target = { campaign, rules: parsed.data };
  } else {
    target = (await livePurchaseCampaigns(shop))[0] ?? null;
  }
  if (!target) return { entries: 0, giveaway: null };
  return {
    entries: estimateEntries(target.rules, lines),
    giveaway: { title: target.campaign.title, slug: target.campaign.slug },
  };
}
