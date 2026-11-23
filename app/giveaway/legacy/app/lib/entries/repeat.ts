import type { Campaign } from "@prisma/client";
import { periodFor } from "../daily";
import { parseSettings } from "../settings";

/**
 * Suffix for a repeatable action's dedupe key: the day it was earned. Daily-draw giveaways
 * use the draw's day (e.g. 9pm to 9pm), others the UTC date. Empty for one-time actions.
 */
export function repeatSuffix(
  campaign: Pick<Campaign, "settings" | "timezone">,
  repeatable: boolean,
  now = new Date(),
) {
  if (!repeatable) return "";
  const daily = parseSettings(campaign.settings).daily;
  return daily.enabled
    ? `:${periodFor(now, campaign.timezone, daily.drawTime).key}`
    : `:${now.toISOString().slice(0, 10)}`;
}

/** The ledger dedupe key completing an action uses, so mirrored awards can't double up. */
export const actionDedupeKey = (
  actionId: string,
  entrantId: string,
  suffix: string,
) => `action:${actionId}:${entrantId}${suffix}`;
