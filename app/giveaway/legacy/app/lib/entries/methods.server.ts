import { Prisma, type EntrySource } from "@prisma/client";
import db from "../../db.server";
import { methodKey, methodRows, type MethodTotals } from "./methods";

/**
 * Entries by method for a giveaway, optionally only those earned in [since, until)
 * (e.g. one daily draw period) or by one entrant.
 */
export async function entriesByMethod(
  campaignId: string,
  opts: { since?: Date; until?: Date; entrantId?: string } = {},
) {
  const since = opts.since
    ? Prisma.sql`AND "createdAt" >= ${opts.since}`
    : Prisma.empty;
  const until = opts.until
    ? Prisma.sql`AND "createdAt" < ${opts.until}`
    : Prisma.empty;
  const entrant = opts.entrantId
    ? Prisma.sql`AND "entrantId" = ${opts.entrantId}`
    : Prisma.empty;
  const [groups, actions] = await Promise.all([
    db.$queryRaw<
      {
        source: EntrySource;
        actionId: string | null;
        entries: bigint | null;
        times: bigint;
        people: bigint;
      }[]
    >`
      SELECT source, "actionId",
             sum(entries) AS entries,
             count(*) FILTER (WHERE entries > 0) AS times,
             count(DISTINCT "entrantId") FILTER (WHERE entries > 0) AS people
      FROM "EntryEvent"
      WHERE "campaignId" = ${campaignId} ${since} ${until} ${entrant}
      GROUP BY source, "actionId"`,
    db.entryAction.findMany({
      where: { campaignId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, type: true, label: true, config: true },
    }),
  ]);
  // Actions and referrals for the same action share a key; their people can overlap,
  // so merging keeps the larger count rather than adding.
  const byKey = new Map<string, MethodTotals>();
  for (const g of groups) {
    const key = methodKey(g.source, g.actionId);
    const t = byKey.get(key) ?? { key, entries: 0, times: 0, people: 0 };
    t.entries += Number(g.entries ?? 0);
    t.times += Number(g.times);
    t.people = Math.max(t.people, Number(g.people));
    byKey.set(key, t);
  }
  return { rows: methodRows([...byKey.values()], actions), actions };
}
