import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
// A referred entrant in a custom campaign earns a referral only after the buyer pays.
// Existing campaign tools can inspect the conversion and any later reversal in their own ledger.
export async function giveCampaignReferral(
  tx: import("@prisma/client").Prisma.TransactionClient,
  customerId: string,
  purchaseId: string,
  amount: number,
) {
  const entrants = await tx.entrant.findMany({
    where: {
      shopifyCustomerId: customerId,
      status: "ACTIVE",
      referredById: { not: null },
      campaign: { shop, status: "ACTIVE" },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      campaignId: true,
      referredBy: {
        select: { id: true, status: true, shopifyCustomerId: true },
      },
      campaign: {
        select: {
          startsAt: true,
          endsAt: true,
          actions: { where: { type: "REFERRAL" }, select: { id: true } },
        },
      },
    },
  });
  const now = new Date();
  for (const e of entrants) {
    if (
      !e.referredBy?.shopifyCustomerId ||
      e.referredBy.shopifyCustomerId === customerId ||
      e.referredBy.status !== "ACTIVE" ||
      !e.campaign.actions[0] ||
      (e.campaign.startsAt && e.campaign.startsAt > now) ||
      (e.campaign.endsAt && e.campaign.endsAt <= now)
    )
      continue;
    const eligible = await tx.cardbitGiveawayPerson.findFirst({
      where: {
        shop,
        customerId: e.referredBy.shopifyCustomerId,
        held: false,
        whatnotAt: { not: null },
      },
    });
    if (!eligible) continue;
    const key = "cardbit-referred-purchase:" + e.id + ":" + purchaseId;
    await tx.entryEvent.upsert({
      where: {
        campaignId_dedupeKey: { campaignId: e.campaignId, dedupeKey: key },
      },
      update: {},
      create: {
        campaignId: e.campaignId,
        entrantId: e.referredBy.id,
        actionId: e.campaign.actions[0].id,
        source: "REFERRAL",
        entries: amount,
        dedupeKey: key,
        note: "Cardbit purchase " + purchaseId,
      },
    });
    return e.referredBy.shopifyCustomerId;
  }
  return null;
}
export async function reverseCampaignReferrals(
  tx: import("@prisma/client").Prisma.TransactionClient,
  id: string,
) {
  const rows = await tx.entryEvent.findMany({
    where: {
      campaign: { shop },
      source: "REFERRAL",
      note: "Cardbit purchase " + id,
    },
  });
  for (const e of rows) {
    const key = "void:" + e.id;
    await tx.entryEvent.upsert({
      where: {
        campaignId_dedupeKey: { campaignId: e.campaignId, dedupeKey: key },
      },
      update: {},
      create: {
        campaignId: e.campaignId,
        entrantId: e.entrantId,
        source: "ROLLBACK",
        entries: -e.entries,
        dedupeKey: key,
        note: "Purchase under review",
        createdAt: new Date(+e.createdAt + 1),
      },
    });
  }
}
