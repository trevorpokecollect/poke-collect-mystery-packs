import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { isCardbit } from "./cardbit.server";
import { defaultColor } from "./cardbit-levels";

/**
 * Weekly leaderboard. Score = Cardbits spent on paid pack openings during the week (Monday 00:00
 * to Sunday 23:59 Central). Demo Openings and free spins never create pack receipts, so they never
 * count. Prizes are paid by staff only after Trevor approves payouts; nothing here awards Cardbits.
 */
export const leaderboardEnabled = (shop: string, env: NodeJS.ProcessEnv = process.env) =>
  isCardbit(shop, env) && env.CARDBIT_LEADERBOARD === "on";

/** Weekly prizes in Cardbits for ranks 1 to 10, 50,000 total (Official Rules draft; not paid automatically). */
export const WEEKLY_PRIZES = [20000, 10000, 6000, 4000, 3000, 1400, 1400, 1400, 1400, 1400];

/** The UTC instants bounding the Central-time week that contains `at`. */
export function weekWindow(at = new Date()) {
  const central = new Date(at.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const offset = central.getTime() - at.getTime();
  const start = new Date(central);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start: new Date(start.getTime() - offset), end: new Date(end.getTime() - offset) };
}

const alias = (customerId: string) =>
  "Collector " + createHash("sha256").update(customerId).digest("hex").slice(0, 4).toUpperCase();

export async function weeklyStandings(db: PrismaClient, shop: string, viewerId?: string, at = new Date()) {
  const { start, end } = weekWindow(at);
  const rows = await db.cardbitReceipt.groupBy({
    by: ["customerId"],
    where: { shop, kind: "pack", createdAt: { gte: start, lt: end } },
    _sum: { delta: true },
  });
  // Accepted mail-in postcards add points (Official Rules, free method of entry).
  const { mailInPoints } = await import("../giveaway/mail-in.server");
  const mailed = await mailInPoints(db, start);
  const scores = new Map<string, number>();
  for (const r of rows) scores.set(r.customerId, -(r._sum.delta ?? 0));
  for (const [id, points] of mailed) scores.set(id, (scores.get(id) ?? 0) + points);
  const ranked = [...scores]
    .map(([customerId, score]) => ({ customerId, score }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.customerId.localeCompare(b.customerId));
  const top = ranked.slice(0, 10);
  const profiles = await db.cardbitProfile.findMany({
    where: { shop, customerId: { in: top.map((r) => r.customerId) } },
    select: { customerId: true, iconId: true, iconColor: true },
  });
  const mine = viewerId ? ranked.findIndex((r) => r.customerId === viewerId) : -1;
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    prizes: WEEKLY_PRIZES,
    top: top.map((r, i) => {
      const p = profiles.find((x) => x.customerId === r.customerId);
      return {
        rank: i + 1,
        name: alias(r.customerId),
        iconId: p?.iconId ?? null,
        color: p?.iconColor ?? defaultColor(r.customerId),
        score: r.score,
        you: r.customerId === viewerId,
      };
    }),
    you: mine >= 0 ? { rank: mine + 1, score: ranked[mine].score } : null,
  };
}
