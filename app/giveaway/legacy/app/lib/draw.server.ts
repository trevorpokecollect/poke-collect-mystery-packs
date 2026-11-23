import db from "../db.server";
import { drawWinners, newSeed, snapshotHash } from "./draw";
import { eligibleTickets } from "./entries/ledger.server";
import { emitWebhook } from "./webhook-out.server";

/**
 * Draws `count` winners from currently eligible (ACTIVE) entrants and records an auditable Draw.
 * `excludeForfeited` (redraws) also keeps out winners who forfeited.
 */
export async function runDraw(
  campaignId: string,
  count: number,
  actor?: string,
  opts: { excludeForfeited?: boolean } = {},
) {
  const draw = await db.$transaction(async (tx) => {
    const tickets = await eligibleTickets(campaignId, tx);
    if (tickets.length === 0)
      throw new Error("No eligible entrants to draw from.");
    // Previous winners of this campaign can't win again.
    const previous = await tx.winner.findMany({
      where: {
        draw: { campaignId },
        ...(opts.excludeForfeited ? {} : { forfeited: false }),
      },
    });
    const excluded = new Set(previous.map((w) => w.entrantId));
    const pool = tickets.filter((t) => !excluded.has(t.entrantId));

    const seed = newSeed();
    const winners = drawWinners(pool, count, seed);
    return tx.draw.create({
      data: {
        campaignId,
        seed,
        snapshotHash: snapshotHash(pool),
        totalEntries: pool.reduce((s, t) => s + t.entries, 0),
        eligibleCount: pool.length,
        createdBy: actor,
        winners: {
          create: winners.map((entrantId, i) => ({
            entrantId,
            position: i + 1 + previous.length,
          })),
        },
      },
      include: { winners: { include: { entrant: true } } },
    });
  });
  emitWebhook(campaignId, "draw.completed", { drawId: draw.id });
  return draw;
}
