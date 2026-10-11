// "Top tier sold out" alert: once every card in a live series' top tier (e.g. Master) has been
// pulled, fire the app's Shopify Flow trigger once, so a Flow workflow can email the merchant
// that the series is ready to close and roll over.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { PrismaClient } from "@prisma/client";
import { gql } from "./orders.server";
import { seriesTierRules } from "./series.server";

export const TOP_TIER_TRIGGER = "mystery-top-tier-sold-out";

export async function checkTopTierGone(db: PrismaClient, admin: AdminApiContext, shop: string, seriesIds: string[]) {
  for (const id of new Set(seriesIds)) {
    const series = await db.series.findFirst({ where: { id, shop, topTierGoneAt: null } });
    if (!series || series.status === "DRAFT") continue;
    const rules = seriesTierRules(series);
    const top = rules[rules.length - 1]?.name;
    if (!top) continue;
    const left = await db.slot.count({ where: { seriesId: id, claimed: false, voided: false, card: { tier: top } } });
    if (left > 0) continue;
    // Claim the alert so it fires once, even if two orders land together.
    const claimed = await db.series.updateMany({ where: { id, topTierGoneAt: null }, data: { topTierGoneAt: new Date() } });
    if (claimed.count === 0) continue;
    const packsLeft = await db.slot.count({ where: { seriesId: id, claimed: false, voided: false } });
    const store = shop.replace(/\.myshopify\.com$/, "");
    try {
      await gql(
        admin,
        `#graphql
          mutation PackFlowTrigger($handle: String!, $payload: JSON!) {
            flowTriggerReceive(handle: $handle, payload: $payload) { userErrors { field message } }
          }`,
        {
          handle: TOP_TIER_TRIGGER,
          payload: {
            Series: series.title,
            Tier: top,
            "Packs left": packsLeft,
            "Admin link": `https://admin.shopify.com/store/${store}/apps/poke-collect-mystery-packs/app/series/${id}`,
          },
        },
      );
    } catch (error) {
      console.error(`Top tier alert for ${series.title} failed`, error);
    }
  }
}
