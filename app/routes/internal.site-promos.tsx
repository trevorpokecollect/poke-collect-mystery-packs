// Card Broker (or the texting provider bridge) → site: promo controls. Same auth as intake.
// POST {action:"sms-confirmed", customerId, phone}   credits the 300 text-alert reward once
// POST {action:"giveaway-settings", enabled, rulesUrl, freeInstructions}   opens/closes the site drawing
// POST {action:"giveaway-status"}   config, today's round and recent results
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { brokerActor, cardBrokerAuthorized } from "../site/core/internal-auth.server";
import { PromoError, SITE_GIVEAWAY_SHOP as shop, confirmSms, setSiteGiveaway, usPhone } from "../site/promos/promos.server";

export const loader = () => new Response("Not found", { status: 404 });

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST" || !cardBrokerAuthorized(request)) return Response.json({ error: "Unavailable." }, { status: 403 });
  const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    if (input?.action === "sms-confirmed") {
      const phone = usPhone(input.phone);
      if (typeof input.customerId !== "string" || !phone) return Response.json({ error: "customerId and phone required." }, { status: 422 });
      return Response.json(await confirmSms(db, input.customerId, phone));
    }
    if (input?.action === "giveaway-settings") {
      await setSiteGiveaway(db, brokerActor(request), input);
      return Response.json({ ok: true });
    }
    if (input?.action === "giveaway-status") {
      const [config, rounds] = await Promise.all([
        db.cardbitGiveawayConfig.findUnique({ where: { shop } }),
        db.cardbitGiveawayRound.findMany({ where: { shop }, orderBy: { day: "desc" }, take: 14,
          select: { day: true, closesAt: true, closedAt: true, winnerId: true, participantCount: true, totalEntries: true, commitment: true, snapshotHash: true } }),
      ]);
      return Response.json({ config, rounds });
    }
    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    if (e instanceof PromoError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
