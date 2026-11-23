import db from "../db.server";
import { hashId } from "./bot/fingerprint.server";
import { isLimited } from "./bot/rate-limit.server";
import { findLiveCampaign } from "./entries/signup.server";
import { centralDate, platformOfAction, recentDates } from "./follow-clicks";

// Counts per network (hashed IP, kept a day in RateLimitHit like sign-ups) per giveaway and
// platform. Generous because phones on the same carrier often share an IP.
const LIMIT_PER_HOUR = 10;

export type ClickResult =
  { counted: true; platform: string } | { counted: false; reason: string };

/**
 * Adds one click for a follow button. The platform comes from the action's own URL on the
 * server, so a request can only count clicks for buttons the giveaway really shows.
 */
export async function recordFollowClick(input: {
  shop: string;
  slug: string;
  actionId: string;
  ip: string;
  now?: Date;
}): Promise<ClickResult> {
  const campaign = await findLiveCampaign(input.shop, input.slug);
  if (!campaign) return { counted: false, reason: "no_campaign" };
  const action = campaign.actions.find((a) => a.id === input.actionId);
  const platform = action ? platformOfAction(action) : null;
  if (!platform) return { counted: false, reason: "not_a_follow_button" };

  const key = `follow:${campaign.id}:${platform}:${hashId(input.ip)}`;
  if (await isLimited(key, LIMIT_PER_HOUR, 3600))
    return { counted: false, reason: "rate_limited" };

  const date = centralDate(input.now);
  await db.followClickDay.upsert({
    where: {
      shop_date_giveaway_platform: {
        shop: input.shop,
        date,
        giveaway: campaign.slug,
        platform,
      },
    },
    create: {
      shop: input.shop,
      date,
      giveaway: campaign.slug,
      platform,
      clicks: 1,
    },
    update: { clicks: { increment: 1 } },
  });
  return { counted: true, platform };
}

/** Rows for the last `days` Central Time dates, newest first. */
export async function followClickStats(opts: {
  days: number;
  shop?: string | null;
  giveaway?: string | null;
  now?: Date;
}) {
  const dates = recentDates(opts.days, opts.now);
  const rows = await db.followClickDay.findMany({
    where: {
      date: { gte: dates[0], lte: dates[dates.length - 1] },
      ...(opts.shop ? { shop: opts.shop } : {}),
      ...(opts.giveaway ? { giveaway: opts.giveaway } : {}),
    },
    orderBy: [{ date: "desc" }, { giveaway: "asc" }, { platform: "asc" }],
  });
  return rows.map((r) => ({
    date: r.date,
    shop: r.shop,
    giveaway: r.giveaway,
    platform: r.platform,
    clicks: r.clicks,
  }));
}
