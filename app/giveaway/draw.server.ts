import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { subscribers } from "./consent.server";
import { drawWinners, snapshotHash } from "./draw";
import { lockDesk, sha } from "./entries.server";
import { giveawayTotals, PRIZE } from "./rules";

// Close only an elapsed period. The seed, eligible snapshot, wallet credit and receipt commit together.
export async function settleRound(
  db: PrismaClient,
  admin: AdminApiContext,
  day: string,
  clock = () => new Date(),
) {
  const where = { shop_day: { shop, day } };
  const round = await db.cardbitGiveawayRound.findUnique({ where });
  if (!round || round.closedAt || round.closesAt > clock()) return false;
  // Drain any check-in already holding the day lock before taking the consent snapshot.
  const tapped = await db.$transaction(async (tx) => {
    await lockDesk(tx);
    return tx.cardbitGiveawayEvent.findMany({
      where: { shop, day, kind: "daily", voided: false },
      select: { customerId: true },
    });
  });
  const opted = await subscribers(
    admin,
    tapped.map((x) => x.customerId),
  );
  return db.$transaction(
    async (tx) => {
      await lockDesk(tx);
      const row = await tx.cardbitGiveawayRound.findUniqueOrThrow({ where });
      const cfg = await tx.cardbitGiveawayConfig.findUnique({
        where: { shop },
      });
      if (!cfg?.enabled || row.closedAt || row.closesAt > clock()) return false;
      const [events, allowed, held] = await Promise.all([
        tx.cardbitGiveawayEvent.findMany({ where: { shop, day } }),
        tx.cardbitGiveawayPerson.findMany({
          where: {
            shop,
            customerId: { in: [...opted] },
            held: false,
            whatnotAt: { not: null },
          },
          select: { customerId: true, code: true },
        }),
        tx.cardbitWallet.findMany({
          where: { shop, held: true, customerId: { in: [...opted] } },
          select: { customerId: true },
        }),
      ]);
      const blocked = new Set(held.map((x) => x.customerId));
      const people = allowed.filter((p) => !blocked.has(p.customerId));
      const byId = new Map(people.map((p) => [p.customerId, p.code]));
      const tickets = giveawayTotals(events, new Set(byId.keys()))
        .map((t) => ({ entrantId: byId.get(t.entrantId)!, entries: t.entries }))
        .sort((a, b) => a.entrantId.localeCompare(b.entrantId));
      const total = tickets.reduce((n, x) => n + x.entries, 0);
      if (!Number.isSafeInteger(total) || total > 2147483647)
        throw Error("Entry count requires review.");
      const code = drawWinners(tickets, 1, row.seed)[0];
      const winnerId = people.find((p) => p.code === code)?.customerId ?? null;
      if (winnerId) {
        const wallet = await tx.cardbitWallet.upsert({
          where: { shop_customerId: { shop, customerId: winnerId } },
          create: { shop, customerId: winnerId, balance: PRIZE },
          update: { balance: { increment: PRIZE } },
        });
        if (wallet.held)
          throw Error("Winner eligibility changed. Retry the draw.");
        await tx.cardbitReceipt.create({
          data: {
            shop,
            customerId: winnerId,
            eventKey: "giveaway:" + day,
            kind: "giveaway-prize",
            delta: PRIZE,
            balanceAfter: wallet.balance,
            qualifyingPaidCents: 0,
            fingerprint: sha(day + "|" + code),
            reason: "Daily giveaway prize",
          },
        });
      }
      await tx.cardbitGiveawayRound.update({
        where,
        data: {
          closedAt: clock(),
          winnerId,
          totalEntries: total,
          participantCount: tickets.length,
          snapshot: tickets,
          snapshotHash: snapshotHash(tickets),
        },
      });
      return true;
    },
    { timeout: 30000 },
  );
}
export async function closeDue(db: PrismaClient, admin: AdminApiContext) {
  const pending = await db.cardbitGiveawayRound.findMany({
    where: { shop, closedAt: null, closesAt: { lte: new Date() } },
    orderBy: { closesAt: "asc" },
    take: 20,
  });
  let closed = 0;
  for (const round of pending)
    if (await settleRound(db, admin, round.day)) closed++;
  return closed;
}
