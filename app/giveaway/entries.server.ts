import {
  giveCampaignReferral,
  reverseCampaignReferrals,
} from "./campaign-referrals.server";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { newSeed } from "./draw";
import { drawWindow, isSocial, paidEntries, SOCIAL, STATES } from "./rules";

export type Tx = Prisma.TransactionClient;
export const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export async function lockDesk(tx: Tx, store = shop) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${store + "/daily-giveaway"}, 0))::text`;
}
export async function activeRound(tx: Tx, now: Date, store = shop) {
  const win = drawWindow(now),
    seed = newSeed();
  return tx.cardbitGiveawayRound.upsert({
    where: { shop_day: { shop: store, day: win.day } },
    update: {},
    create: { shop: store, ...win, seed, commitment: sha(seed) },
  });
}
type EventInput = {
  day: string;
  customerId: string;
  key: string;
  kind: string;
  entries: number;
  note?: string;
  actor?: string;
};
export async function post(tx: Tx, input: EventInput, store = shop) {
  return tx.cardbitGiveawayEvent.upsert({
    where: { shop_key: { shop: store, key: input.key } },
    create: { shop: store, ...input },
    update: {},
  });
}
export async function capturePaidEntries(
  tx: Tx,
  store: string,
  order: { id: string; customerId: string; amount: number; paidCents?: number },
) {
  if (store !== shop || !order.paidCents || !paidEntries(order.amount)) return;
  await lockDesk(tx);
  if (
    !(await tx.cardbitGiveawayConfig.findUnique({ where: { shop } }))?.enabled
  )
    return;
  const { day } = await activeRound(tx, new Date());
  await post(tx, {
    day,
    customerId: order.customerId,
    key: "fund:" + order.id,
    kind: "purchase",
    entries: paidEntries(order.amount),
  });
}
export async function reviewPaidEntries(
  tx: Tx,
  store: string,
  orderId: string,
) {
  if (store !== shop) return;
  await lockDesk(tx);
  const event = await tx.cardbitGiveawayEvent.findUnique({
    where: { shop_key: { shop, key: "fund:" + orderId } },
  });
  if (!event || event.voided) return;
  const round = await tx.cardbitGiveawayRound.findUnique({
    where: { shop_day: { shop, day: event.day } },
  });
  if (round?.closedAt) {
    await tx.cardbitGiveawayAudit.create({
      data: {
        shop,
        actor: "payment-review",
        action: "closed-draw-funding-review",
        detail: event.day + " " + event.key,
      },
    });
  }
  await tx.cardbitGiveawayEvent.update({
    where: { id: event.id },
    data: { voided: true },
  });
}
export async function enterOrBonus(
  db: PrismaClient,
  customerId: string,
  body: Record<string, unknown>,
  store = shop,
) {
  return db.$transaction(async (tx) => {
    await lockDesk(tx, store);
    const cfg = await tx.cardbitGiveawayConfig.findUnique({ where: { shop: store } });
    if (!cfg?.enabled) throw Error("The daily giveaway is paused.");
    const now = new Date(),
      { day } = await activeRound(tx, now, store);
    if (
      body.intent === "enter" &&
      body.expectedDay != null &&
      body.expectedDay !== day
    )
      throw Error("The daily draw changed. Tap again to join the new draw.");
    let person = await tx.cardbitGiveawayPerson.findUnique({
      where: { shop_customerId: { shop: store, customerId } },
    });
    const wallet = await tx.cardbitWallet.findUnique({
      where: { shop_customerId: { shop: store, customerId } },
      select: { held: true },
    });
    if (person?.held || wallet?.held)
      throw Error("Your entry is under review.");
    const key = "daily:" + day + ":" + customerId;
    const tapped = await tx.cardbitGiveawayEvent.findUnique({
      where: { shop_key: { shop: store, key } },
    });
    if (body.intent === "whatnot") {
      if (!person) {
        const region = String(body.region ?? "");
        if (body.adult !== true || !STATES.includes(region))
          throw Error(
            "Confirm you are 18 or older and select your US state or DC.",
          );
        const referrer =
          typeof body.ref === "string" && /^[a-f0-9-]{36}$/i.test(body.ref)
            ? await tx.cardbitGiveawayPerson.findFirst({
                where: { shop: store, code: body.ref, held: false },
              })
            : null;
        person = await tx.cardbitGiveawayPerson.create({
          data: {
            shop: store,
            customerId,
            region,
            ageConfirmedAt: now,
            whatnotAt: now,
            referredBy:
              referrer && referrer.customerId !== customerId
                ? referrer.customerId
                : null,
          },
        });
      } else if (!person.whatnotAt) {
        await tx.cardbitGiveawayPerson.update({
          where: { shop_customerId: { shop: store, customerId } },
          data: { whatnotAt: now },
        });
      }
      await post(tx, {
        day,
        customerId,
        key: "whatnot:" + customerId,
        kind: "whatnot",
        entries: SOCIAL.whatnot.entries,
      }, store);
      return;
    }
    if (!person?.whatnotAt) throw Error("Visit Whatnot once before entering.");
    if (body.intent === "enter") {
      const bonus = await post(tx, {
        day,
        customerId,
        key: "whatnot:" + customerId,
        kind: "whatnot",
        entries: SOCIAL.whatnot.entries,
      }, store);
      if (bonus.day !== day) {
        const used = await tx.cardbitGiveawayEvent.findUnique({
          where: {
            shop_key: { shop: store, key: "daily:" + bonus.day + ":" + customerId },
          },
        });
        if (!used)
          await tx.cardbitGiveawayEvent.update({
            where: { id: bonus.id },
            data: { day },
          });
      }
      const entry = await post(tx, {
        day,
        customerId,
        key,
        kind: "daily",
        entries: 1,
      }, store);
      if (entry.voided) throw Error("Your entry is under review.");
      return { day, entered: true, dailyEntries: 1 };
    }
    if (!tapped || tapped.voided) throw Error("Enter today's giveaway first.");
    if (
      body.intent === "social" &&
      isSocial(body.network) &&
      body.network !== "whatnot"
    ) {
      const network = body.network;
      await post(tx, {
        day,
        customerId,
        key: network + ":" + customerId,
        kind: network,
        entries: SOCIAL[network].entries,
      }, store);
      return;
    }
    if (body.intent === "share" && cfg.shareEntries) {
      await post(tx, {
        day,
        customerId,
        key: "share:" + day + ":" + customerId,
        kind: "share",
        entries: cfg.shareEntries,
      }, store);
      return;
    }
    throw Error("Choose an available giveaway action.");
  });
}

// Called only after the order/payment or wallet debit is verified. The unique key is the referred customer.
export async function qualifyReferral(
  tx: Tx,
  customerId: string,
  purchaseId: string,
  day: string,
) {
  const cfg = await tx.cardbitGiveawayConfig.findUnique({ where: { shop } });
  if (!cfg?.enabled || !cfg.referralEntries) return;
  const key = "referral:" + customerId;
  const old = await tx.cardbitGiveawayEvent.findUnique({
    where: { shop_key: { shop, key } },
  });
  if (old) {
    if (!old.voided || old.note === purchaseId) return;
    const original = await tx.cardbitGiveawayRound.findUnique({
      where: { shop_day: { shop, day: old.day } },
    });
    if (original?.closedAt) return; // A settled snapshot is immutable; the owner sees its refund review.
    await tx.cardbitGiveawayEvent.update({
      where: { id: old.id },
      data: { key: "reversed:" + old.id },
    });
  }
  const person = await tx.cardbitGiveawayPerson.findUnique({
    where: { shop_customerId: { shop, customerId } },
  });
  if (!person || person.held) return;
  let recipient = person.referredBy,
    points = cfg.referralEntries;
  if (!recipient) {
    recipient = await giveCampaignReferral(tx, customerId, purchaseId, points);
    if (!recipient) return;
    points = 0; // The custom campaign issued these entries. Reserve one program-wide conversion key.
  } else {
    const referrer = await tx.cardbitGiveawayPerson.findUnique({
      where: { shop_customerId: { shop, customerId: recipient } },
    });
    if (!referrer || referrer.held) return;
  }
  await post(tx, {
    day,
    customerId: recipient,
    key,
    kind: "referral",
    entries: points,
    note: purchaseId,
  });
}

export async function recordReferralPurchase(
  tx: Tx,
  store: string,
  customerId: string,
  purchaseId: string,
) {
  if (store !== shop) return;
  await lockDesk(tx);
  const cfg = await tx.cardbitGiveawayConfig.findUnique({ where: { shop } });
  if (!cfg?.enabled) return;
  const { day } = await activeRound(tx, new Date());
  await qualifyReferral(tx, customerId, purchaseId, day);
}
export async function reviewReferral(tx: Tx, orderId: string) {
  await reverseCampaignReferrals(tx, orderId);
  // Include the order in the filter so a refund cannot reverse an unrelated referral.
  const rows = await tx.cardbitGiveawayEvent.findMany({
    where: { shop, kind: "referral", note: orderId, voided: false },
  });
  for (const e of rows) {
    await tx.cardbitGiveawayEvent.update({
      where: { id: e.id },
      data: { voided: true },
    });
    await tx.cardbitGiveawayAudit.create({
      data: {
        shop,
        actor: "payment-review",
        action: "referral-funding-review",
        detail: e.day + " " + e.key,
      },
    });
  }
}
