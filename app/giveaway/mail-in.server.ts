import type { PrismaClient } from "@prisma/client";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { cardbitDay } from "../lib/cardbit-levels";
import { leaderboardEnabled, weekWindow } from "../lib/cardbit-leaderboard.server";
import { dailySpin, spinnerEnabled } from "../lib/cardbit-spinner.server";
import { activeRound, lockDesk, post } from "./entries.server";
import { drawWindow, EXCLUDED_STATES, STATES } from "./rules";

/**
 * Mail-in (no purchase necessary) entries. Staff log every postcard they open, accepted or not.
 * The Official Rules set these values; change them together.
 *
 * - Daily Giveaway: one postcard per person per drawing, worth the most a person can earn free
 *   online in one drawing (the daily entry plus the daily share).
 * - Weekly Leaderboard: 1,000 points per postcard (the score of a 1,000-Cardbit pack), up to 7 per
 *   person per week.
 * - Daily Spinner: one spin, run by the same engine as an online spin, counted as that day's spin.
 */
export const MAIL_IN = {
  leaderboardPoints: 1000,
  leaderboardWeeklyLimit: 7,
} as const;
export type MailInPromo = "giveaway" | "leaderboard" | "spin";
const PROMOS: MailInPromo[] = ["giveaway", "leaderboard", "spin"];
export const REJECT_REASONS = [
  "Missing required information",
  "Not handwritten or mechanically reproduced",
  "More than one request in the envelope",
  "Over the limit for this period",
  "Resident of an excluded state or outside the US",
  "Under 18 or age not confirmed",
  "No matching Cardbit account",
  "Received after the promotion ended",
  "Illegible",
] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const REF = /^MI-\d{8}-\d{3,4}$/;

export class MailInError extends Error {}

type Input = Record<string, unknown>;

/** Weekly mail-in leaderboard points per customer, keyed by the week's start (ISO). */
export async function mailInPoints(db: PrismaClient, start: Date) {
  const rows = await db.cardbitMailIn.groupBy({
    by: ["customerId"],
    where: {
      shop,
      promo: "leaderboard",
      status: "accepted",
      period: start.toISOString(),
    },
    _sum: { value: true },
  });
  return new Map(
    rows
      .filter((r) => r.customerId)
      .map((r) => [r.customerId as string, r._sum.value ?? 0]),
  );
}

export async function mailInLog(db: PrismaClient) {
  return db.cardbitMailIn.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      ref: true,
      customerId: true,
      promo: true,
      period: true,
      receivedOn: true,
      value: true,
      status: true,
      reason: true,
      createdAt: true,
    },
  });
}

/**
 * Log one postcard. `customerId` comes from the server's account lookup of the email written on the
 * card, never from the browser. A repeat of the same reference with the same details is a no-op.
 */
export async function logMailIn(
  db: PrismaClient,
  actor: string,
  input: Input,
  customerId: string | null,
  now = new Date(),
) {
  const promo = String(input.promo) as MailInPromo;
  const ref = String(input.ref ?? "").trim().toUpperCase();
  const receivedOn = String(input.receivedOn ?? "");
  const postmarkedOn = input.postmarkedOn ? String(input.postmarkedOn) : null;
  const region = String(input.region ?? "").toUpperCase();
  const rejected = input.reject ? String(input.reject) : "";
  if (!PROMOS.includes(promo)) throw new MailInError("Choose the promotion on the postcard.");
  if (!REF.test(ref))
    throw new MailInError("Write the log number as MI-YYYYMMDD-NNN (the day you opened it).");
  if (!DAY.test(receivedOn) || receivedOn > cardbitDay(now))
    throw new MailInError("Enter the date the postcard arrived.");
  if (postmarkedOn && (!DAY.test(postmarkedOn) || postmarkedOn > receivedOn))
    throw new MailInError("The postmark date must be on or before the received date.");
  if (rejected && !(REJECT_REASONS as readonly string[]).includes(rejected))
    throw new MailInError("Choose a rejection reason from the list.");

  const prior = await db.cardbitMailIn.findUnique({ where: { shop_ref: { shop, ref } } });
  if (prior) {
    if (prior.promo !== promo || prior.customerId !== customerId)
      throw new MailInError("This log number is already used for another postcard.");
    return prior;
  }

  const reason =
    rejected ||
    (!customerId
      ? "No matching Cardbit account"
      : (EXCLUDED_STATES as readonly string[]).includes(region) || !STATES.includes(region)
        ? "Resident of an excluded state or outside the US"
        : input.adult !== true
          ? "Under 18 or age not confirmed"
          : "");
  const base = { shop, ref, customerId, promo, receivedOn, postmarkedOn, region, actor };

  if (reason) {
    const period =
      promo === "giveaway"
        ? drawWindow(now).day
        : promo === "leaderboard"
          ? weekWindow(now).start.toISOString()
          : cardbitDay(now);
    return db.cardbitMailIn.create({ data: { ...base, period, status: "rejected", reason } });
  }
  const id = customerId as string;

  if (promo === "giveaway") {
    return db.$transaction(async (tx) => {
      await lockDesk(tx);
      const cfg = await tx.cardbitGiveawayConfig.findUnique({ where: { shop } });
      if (!cfg?.enabled)
        throw new MailInError("The Daily Giveaway is paused. Hold the postcard until it opens.");
      const { day } = await activeRound(tx, now);
      const used = await tx.cardbitMailIn.count({
        where: { shop, promo, period: day, customerId: id, status: "accepted" },
      });
      if (used >= 1)
        return tx.cardbitMailIn.create({
          data: { ...base, period: day, status: "rejected", reason: "Over the limit for this period" },
        });
      const person = await tx.cardbitGiveawayPerson.findUnique({
        where: { shop_customerId: { shop, customerId: id } },
      });
      if (person?.held) throw new MailInError("This account is on hold for review.");
      if (!person)
        await tx.cardbitGiveawayPerson.create({
          data: { shop, customerId: id, region, ageConfirmedAt: now },
        });
      const entries = 1 + cfg.shareEntries;
      await post(tx, {
        day,
        customerId: id,
        key: "mail:" + ref,
        kind: "mail-in",
        entries,
        actor,
        note: "Postcard " + ref + " received " + receivedOn,
      });
      const row = await tx.cardbitMailIn.create({
        data: { ...base, period: day, status: "accepted", value: entries },
      });
      await tx.cardbitGiveawayAudit.create({
        data: { shop, actor, action: "mail-in", detail: ref + " " + id + " " + entries },
      });
      return row;
    });
  }

  if (promo === "leaderboard") {
    if (!leaderboardEnabled(shop))
      throw new MailInError("The Weekly Leaderboard is not open. Hold the postcard until it opens.");
    const period = weekWindow(now).start.toISOString();
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${shop + "/mail-in/" + id}, 0))::text`;
      const used = await tx.cardbitMailIn.count({
        where: { shop, promo, period, customerId: id, status: "accepted" },
      });
      const over = used >= MAIL_IN.leaderboardWeeklyLimit;
      return tx.cardbitMailIn.create({
        data: {
          ...base,
          period,
          status: over ? "rejected" : "accepted",
          reason: over ? "Over the limit for this period" : null,
          value: over ? 0 : MAIL_IN.leaderboardPoints,
        },
      });
    });
  }

  // Daily Spinner: the same one-spin-per-day engine. A person who already spun today waits a day.
  if (!spinnerEnabled(shop))
    throw new MailInError("The Daily Spinner is not open. Hold the postcard until it opens.");
  const spin = await dailySpin(db, shop, id, now);
  if (spin.replay)
    throw new MailInError(
      "This collector already spun today. Keep the postcard and log it again tomorrow.",
    );
  return db.cardbitMailIn.create({
    data: { ...base, period: spin.day, status: "accepted", value: 1, spinId: spin.id },
  });
}
