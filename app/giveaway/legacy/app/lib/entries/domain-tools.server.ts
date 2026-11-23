import db from "../../db.server";
import { isBlockedDomain, isCommonDomain } from "../bot/domains";

// Admin clean-up for bot farms: entrants grouped by email domain, and disqualifying (or
// restoring) everyone on one domain at once. Disqualified entrants keep their ledger rows;
// they just stop counting in draws, and Restore puts them back.

export interface DomainRow {
  domain: string;
  active: number;
  disqualified: number;
  blocked: boolean;
}

/** Uncommon domains with at least `min` entrants in this giveaway, biggest first. */
export async function suspiciousDomains(
  campaignId: string,
  min = 8,
): Promise<DomainRow[]> {
  const rows = await db.$queryRaw<
    { domain: string; active: bigint; disqualified: bigint }[]
  >`SELECT split_part("emailNormalized", '@', 2) AS domain,
           count(*) FILTER (WHERE status <> 'DISQUALIFIED') AS active,
           count(*) FILTER (WHERE status = 'DISQUALIFIED') AS disqualified
      FROM "Entrant"
     WHERE "campaignId" = ${campaignId}
     GROUP BY 1
    HAVING count(*) >= ${min}
     ORDER BY count(*) DESC
     LIMIT 50`;
  return rows
    .filter((r) => r.domain && !isCommonDomain(r.domain))
    .map((r) => ({
      domain: r.domain,
      active: Number(r.active),
      disqualified: Number(r.disqualified),
      blocked: isBlockedDomain(r.domain),
    }));
}

/** Disqualifies every entrant on `domain` who isn't already; returns their ids. */
export async function disqualifyDomain(campaignId: string, domain: string) {
  const d = domain.trim().toLowerCase().replace(/^@/, "");
  if (!d || isCommonDomain(d)) return [];
  const ids = (
    await db.entrant.findMany({
      where: {
        campaignId,
        emailNormalized: { endsWith: `@${d}` },
        status: { not: "DISQUALIFIED" },
      },
      select: { id: true },
    })
  ).map((e) => e.id);
  if (ids.length)
    await db.entrant.updateMany({
      where: { id: { in: ids } },
      data: { status: "DISQUALIFIED" },
    });
  return ids;
}

/** Undo: everyone disqualified on `domain` goes back to active. */
export async function restoreDomain(campaignId: string, domain: string) {
  const d = domain.trim().toLowerCase().replace(/^@/, "");
  if (!d) return 0;
  const r = await db.entrant.updateMany({
    where: {
      campaignId,
      emailNormalized: { endsWith: `@${d}` },
      status: "DISQUALIFIED",
    },
    data: { status: "ACTIVE" },
  });
  return r.count;
}
