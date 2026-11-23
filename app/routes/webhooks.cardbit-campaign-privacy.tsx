import type { ActionFunctionArgs } from "react-router";
import { randomUUID } from "node:crypto";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { CARDBIT_SHOP } from "../lib/cardbit.server";
import { lockDesk } from "../giveaway/entries.server";
import { normalizeEmail } from "../giveaway/legacy/app/lib/bot/email";
export async function action({ request }: ActionFunctionArgs) {
  const { shop, topic, payload } = await authenticate.webhook(request);
  if (shop !== CARDBIT_SHOP) return new Response(null, { status: 204 });
  if (topic === "CUSTOMERS_REDACT" && payload.customer?.id) {
    const id = "gid://shopify/Customer/" + payload.customer.id,
      anon = "redacted:" + randomUUID();
    await db.$transaction(async (tx) => {
      await lockDesk(tx);
      await tx.entrant.deleteMany({
        where: {
          campaign: { shop },
          OR: [
            { shopifyCustomerId: id },
            ...(payload.customer.email
              ? [{ emailNormalized: normalizeEmail(payload.customer.email) }]
              : []),
          ],
        },
      });
      await tx.cardbitGiveawayPerson.updateMany({
        where: { shop, referredBy: id },
        data: { referredBy: null },
      });
      await tx.cardbitGiveawayPerson.deleteMany({
        where: { shop, customerId: id },
      });
      await tx.cardbitGiveawayEvent.deleteMany({
        where: { shop, OR: [{ customerId: id }, { key: "referral:" + id }] },
      });
      await tx.cardbitGiveawayRound.updateMany({
        where: { shop, winnerId: id },
        data: { winnerId: anon, notifiedAt: new Date() },
      });
      await tx.cardbitGiveawayAudit.deleteMany({
        where: { shop, detail: { contains: id } },
      });
    });
  }
  if (topic === "SHOP_REDACT")
    await db.$transaction(async (tx) => {
      await lockDesk(tx);
      await tx.campaign.deleteMany({ where: { shop } });
      await tx.campaignImage.deleteMany({ where: { shop } });
      await tx.auditLog.deleteMany({ where: { shop } });
      await tx.followClickDay.deleteMany({ where: { shop } });
      await tx.cardbitGiveawayEvent.deleteMany({ where: { shop } });
      await tx.cardbitGiveawayRound.deleteMany({ where: { shop } });
      await tx.cardbitGiveawayPerson.deleteMany({ where: { shop } });
      await tx.cardbitGiveawayAudit.deleteMany({ where: { shop } });
      await tx.cardbitGiveawayConfig.deleteMany({ where: { shop } });
    });
  return new Response(null, { status: 204 });
}
