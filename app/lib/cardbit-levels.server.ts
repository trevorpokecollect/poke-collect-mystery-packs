import type { Prisma, PrismaClient } from "@prisma/client";
import { featureOn } from "./cardbit-flags.server";
import { sparksEnabled } from "./cardbit-sparks.server";
import { spinsView } from "./cardbit-spinner.server";
import { STREAK_CARD_BONUS } from "./cardbit-spinner";
import {
  AVATAR_COLORS,
  ICONS,
  SPINNER_TIERS,
  XP_RULES,
  cardbitDay,
  defaultColor,
  iconUnlocked,
  levelProgress,
  packXp,
  previousDay,
  rankFor,
  spinnerFor,
  type AvatarColor,
} from "./cardbit-levels";

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

/** Levels stay off until CARDBIT_LEVELS=on (everyone) or "qa" (CARDBIT_QA_CUSTOMERS only). */
export const levelsEnabled = (shop: string, customerId?: string | null, env: NodeJS.ProcessEnv = process.env) =>
  featureOn("CARDBIT_LEVELS", shop, customerId, env);

/** Prize features stay off until official rules, a free entry method and Trevor's approval exist. */
export const engagementFlags = (shop: string, customerId?: string | null, env: NodeJS.ProcessEnv = process.env) => ({
  spinner: featureOn("CARDBIT_SPINNER", shop, customerId, env),
  leaderboard: featureOn("CARDBIT_LEADERBOARD", shop, customerId, env),
  sparks: featureOn("CARDBIT_SPARKS", shop, customerId, env),
  subscriptions: featureOn("CARDBIT_SUBSCRIPTIONS", shop, customerId, env),
});

export class LevelError extends Error {}

/** Creates the profile row safely under concurrent first requests, then returns it. */
async function ensureProfile(db: Db, shop: string, customerId: string, lock = false) {
  await db.$executeRaw`INSERT INTO "CardbitProfile" (shop, "customerId", "updatedAt") VALUES (${shop}, ${customerId}, NOW()) ON CONFLICT (shop, "customerId") DO NOTHING`;
  if (lock)
    await db.$queryRaw`SELECT "customerId" FROM "CardbitProfile" WHERE shop=${shop} AND "customerId"=${customerId} FOR UPDATE`;
  return db.cardbitProfile.findUniqueOrThrow({ where: { shop_customerId: { shop, customerId } } });
}

/**
 * Record XP once per event key. A repeated key (retry, replay, refresh) returns the first award.
 * Call inside the transaction that records the qualifying action.
 */
export async function awardXp(
  tx: Tx,
  input: { shop: string; customerId: string; eventKey: string; kind: string; xp: number; source?: string },
) {
  if (!Number.isSafeInteger(input.xp) || input.xp === 0) return null;
  const existing = await tx.cardbitXpEvent.findUnique({
    where: { shop_eventKey: { shop: input.shop, eventKey: input.eventKey } },
  });
  if (existing) return existing;
  await ensureProfile(tx, input.shop, input.customerId);
  const event = await tx.cardbitXpEvent.create({
    data: {
      shop: input.shop,
      customerId: input.customerId,
      eventKey: input.eventKey,
      kind: input.kind,
      xp: input.xp,
      source: input.source ?? null,
    },
  });
  await tx.cardbitProfile.update({
    where: { shop_customerId: { shop: input.shop, customerId: input.customerId } },
    data: { xp: { increment: input.xp } },
  });
  return event;
}

/** XP for a paid Cardbits pack opening. Demo Openings never call this. */
export function awardPackXp(tx: Tx, shop: string, customerId: string, receiptKey: string, cardbitsSpent: number) {
  if (!levelsEnabled(shop, customerId)) return Promise.resolve(null);
  return awardXp(tx, {
    shop,
    customerId,
    eventKey: "pack:" + receiptKey,
    kind: "pack",
    xp: packXp(cardbitsSpent),
    source: receiptKey,
  });
}

/** Take back XP from a refunded or reversed action, once. Total XP never drops below zero. */
export async function reverseXp(tx: Tx, shop: string, eventKey: string, reason: string) {
  const original = await tx.cardbitXpEvent.findUnique({ where: { shop_eventKey: { shop, eventKey } } });
  if (!original || original.xp <= 0) return null;
  const key = "reverse:" + eventKey;
  const profile = await ensureProfile(tx, shop, original.customerId, true);
  const done = await tx.cardbitXpEvent.findUnique({ where: { shop_eventKey: { shop, eventKey: key } } });
  if (done) return done;
  const xp = -Math.min(original.xp, profile.xp);
  const event = await tx.cardbitXpEvent.create({
    data: { shop, customerId: original.customerId, eventKey: key, kind: "reversal", xp, source: reason },
  });
  if (xp)
    await tx.cardbitProfile.update({
      where: { shop_customerId: { shop, customerId: original.customerId } },
      data: { xp: { increment: xp } },
    });
  return event;
}

/** Once per Cardbit day (Central). Returns the same result on repeat calls that day. */
export async function dailyCheckIn(db: PrismaClient, shop: string, customerId: string, at = new Date()) {
  const day = cardbitDay(at);
  return db.$transaction(async (tx) => {
    const profile = await ensureProfile(tx, shop, customerId, true);
    if (profile.lastCheckInDay === day)
      return { day, streak: profile.streak, xp: 0, already: true };
    const streak = profile.lastCheckInDay === previousDay(day) ? profile.streak + 1 : 1;
    await tx.cardbitProfile.update({
      where: { shop_customerId: { shop, customerId } },
      data: { streak, lastCheckInDay: day },
    });
    await awardXp(tx, {
      shop,
      customerId,
      eventKey: "checkin:" + customerId + ":" + day,
      kind: "checkin",
      xp: XP_RULES.dailyCheckIn,
    });
    return { day, streak, xp: XP_RULES.dailyCheckIn, already: false };
  });
}

export async function setAvatar(
  db: Db,
  shop: string,
  customerId: string,
  input: { iconId?: unknown; color?: unknown },
) {
  const profile = await ensureProfile(db, shop, customerId);
  const { level } = levelProgress(profile.xp);
  const data: { iconId?: string | null; iconColor?: string } = {};
  if (input.iconId !== undefined) {
    if (input.iconId === null) data.iconId = null;
    else {
      const icon = ICONS.find((i) => i.id === input.iconId);
      if (!icon) throw new LevelError("Choose an icon from the list.");
      if (!iconUnlocked(icon, level)) throw new LevelError(`Reach Level ${icon.minLevel} to unlock ${icon.name}.`);
      data.iconId = icon.id;
    }
  }
  if (input.color !== undefined) {
    if (!AVATAR_COLORS.some((c) => c.id === input.color)) throw new LevelError("Choose a color from the list.");
    data.iconColor = input.color as AvatarColor;
  }
  return db.cardbitProfile.update({ where: { shop_customerId: { shop, customerId } }, data });
}

export async function rewardsView(db: PrismaClient, shop: string, customerId: string, at = new Date()) {
  const [profile, sparkWallet] = await Promise.all([
    db.cardbitProfile.findUnique({ where: { shop_customerId: { shop, customerId } } }),
    sparksEnabled(shop, customerId) ? db.cardbitSparkWallet.findUnique({ where: { shop_customerId: { shop, customerId } } }) : null,
  ]);
  const features = engagementFlags(shop, customerId);
  const xp = profile?.xp ?? 0;
  const progress = levelProgress(xp);
  const day = cardbitDay(at);
  const streakAlive = profile?.lastCheckInDay === day || profile?.lastCheckInDay === previousDay(day);
  const streak = streakAlive ? (profile?.streak ?? 0) : 0;
  const monthStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const month = await db.cardbitXpEvent.aggregate({
    where: { shop, customerId, createdAt: { gte: monthStart } },
    _sum: { xp: true },
  });
  const monthXp = Math.max(0, month._sum.xp ?? 0);
  return {
    enabled: true,
    ...progress,
    checkedInToday: profile?.lastCheckInDay === day,
    streak,
    avatar: {
      iconId: profile?.iconId ?? null,
      color: (profile?.iconColor as AvatarColor | null) ?? defaultColor(customerId),
    },
    colors: AVATAR_COLORS,
    icons: ICONS.map((i) => ({ ...i, unlocked: iconUnlocked(i, progress.level) })),
    rank: rankFor(progress.level),
    monthXp,
    spinner: { current: spinnerFor(progress.level), tiers: SPINNER_TIERS },
    streakBonus: { perDay: STREAK_CARD_BONUS.perDay, maxDays: STREAK_CARD_BONUS.maxDays },
    rules: XP_RULES,
    features,
    spins: features.spinner ? await spinsView(db, shop, customerId, progress.level, streak, at) : null,
    sparks: features.sparks ? { balance: sparkWallet?.balance ?? 0 } : null,
  };
}
