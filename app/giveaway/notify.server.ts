import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
// A Klaviyo event with a stable unique_id is safe to retry if the response is lost. The corresponding Cardbit flow sends the email.
export async function notifyWinners(db: PrismaClient, admin: AdminApiContext) {
  const key = process.env.CARDBIT_GIVEAWAY_KLAVIYO_PRIVATE_KEY;
  if (!key) return 0;
  const wins = await db.cardbitGiveawayRound.findMany({
    where: {
      shop,
      winnerId: { not: null },
      closedAt: { not: null },
      notifiedAt: null,
    },
    orderBy: { day: "asc" },
    take: 20,
  });
  let count = 0;
  for (const r of wins) {
    const res = await admin.graphql(
      `#graphql
   query CardbitGiveawayWinnerEmail($id:ID!){customer(id:$id){id defaultEmailAddress{emailAddress}}}
  `,
      { variables: { id: r.winnerId } },
    );
    const data = await res.json();
    const email = data.data?.customer?.defaultEmailAddress?.emailAddress;
    if (!res.ok || ("errors" in data && data.errors) || !email) continue;
    const event = await fetch("https://a.klaviyo.com/api/events/", {
      method: "POST",
      headers: {
        Authorization: "Klaviyo-API-Key " + key,
        revision: "2026-01-15",
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        data: {
          type: "event",
          attributes: {
            unique_id: "cardbit-daily-" + r.day,
            metric: {
              data: {
                type: "metric",
                attributes: { name: "Cardbit Daily Giveaway Won" },
              },
            },
            profile: { data: { type: "profile", attributes: { email } } },
            time: r.closedAt!.toISOString(),
            properties: { draw_day: r.day, prize_cardbits: 10000 },
          },
        },
      }),
    });
    if (!event.ok)
      throw Error("Cardbit winner notification could not be queued.");
    await db.cardbitGiveawayRound.update({
      where: { shop_day: { shop, day: r.day } },
      data: { notifiedAt: new Date() },
    });
    count++;
  }
  return count;
}
