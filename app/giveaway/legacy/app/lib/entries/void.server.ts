import type { EntrySource, Prisma } from "@prisma/client";
import db from "../../db.server";
import { award } from "./ledger.server";
import { entrantSearchWhere } from "./search";
import { methodLabel, type MethodAction } from "./methods";

// Disqualifying a single entry: a rollback that cancels one ledger event, keyed so it can only
// happen once and can be undone ("Restore"). The original event stays in the log.

const voidKey = (eventId: string) => `void:${eventId}`;
const VOID_NOTE = "disqualified";

export async function voidEvent(
  campaignId: string,
  eventId: string,
  reason: string,
) {
  const e = await db.entryEvent.findFirst({
    where: { id: eventId, campaignId },
  });
  if (!e || e.entries <= 0 || e.dedupeKey?.startsWith("void:"))
    return { error: "That entry can't be disqualified." };
  const done = await award({
    campaignId,
    entrantId: e.entrantId,
    entries: -e.entries,
    source: "ROLLBACK",
    orderLogId: e.orderLogId ?? undefined,
    note: reason.trim() ? `${VOID_NOTE}: ${reason.trim()}` : VOID_NOTE,
    dedupeKey: voidKey(e.id),
    // Same draw day as the entry it cancels, so a daily draw nets to zero there.
    createdAt: new Date(e.createdAt.getTime() + 1),
  });
  return done ? { ok: true } : { error: "Already disqualified." };
}

export async function restoreEvent(campaignId: string, eventId: string) {
  const { count } = await db.entryEvent.deleteMany({
    where: { campaignId, dedupeKey: voidKey(eventId) },
  });
  return count ? { ok: true } : { error: "That entry isn't disqualified." };
}

/** Which of these events have been disqualified, with the reason. */
export async function voidedEvents(campaignId: string, eventIds: string[]) {
  if (!eventIds.length) return new Map<string, string>();
  const rows = await db.entryEvent.findMany({
    where: { campaignId, dedupeKey: { in: eventIds.map(voidKey) } },
    select: { dedupeKey: true, note: true },
  });
  return new Map(
    rows.map((r) => [
      r.dedupeKey!.slice("void:".length),
      r.note?.replace(/^disqualified:?\s*/, "") ?? "",
    ]),
  );
}

/** Ledger filter for one row of the entries-by-method table (see methodKey). */
export function methodWhere(key: string): Prisma.EntryEventWhereInput {
  // Actions that were deleted outright (their events lost the action link).
  if (key === "removed")
    return { actionId: null, source: { in: ["ACTION", "REFERRAL"] } };
  if (key.startsWith("action:"))
    return {
      actionId: key.slice("action:".length),
      source: { in: ["ACTION", "REFERRAL"] },
    };
  return { source: key.toUpperCase() as EntrySource };
}

/** A plain-language line for one ledger event, e.g. "Follow Us On Whatnot" or "Order #1234". */
export function describeEvent(
  e: {
    source: EntrySource;
    actionId: string | null;
    note: string | null;
    dedupeKey: string | null;
    orderLog?: { orderName: string | null } | null;
  },
  actions: MethodAction[],
) {
  if (e.dedupeKey?.startsWith("void:")) {
    const reason = e.note?.replace(/^disqualified:?\s*/, "");
    return reason ? `Entry disqualified (${reason})` : "Entry disqualified";
  }
  if (e.source === "PURCHASE" || (e.source === "ROLLBACK" && e.orderLog)) {
    const name = e.orderLog?.orderName ?? "order";
    return e.source === "PURCHASE"
      ? `Order ${name}`
      : `Order ${name} (${e.note ?? "changed"})`;
  }
  if (e.source === "REFERRAL") return "Referred a friend";
  if (e.source === "IMPORT") return "Imported from GiveawayNinja";
  if (e.source === "ADJUSTMENT")
    return e.note ? `Adjustment (${e.note})` : "Adjustment";
  if (e.source === "ROLLBACK")
    return e.note ? `Removed (${e.note})` : "Removed";
  return methodLabel(e.source, e.actionId, actions);
}

/** Newest ledger events for a giveaway, optionally one method or entrants matching a search. */
export async function activityFeed(
  campaignId: string,
  opts: { method?: string; q?: string; take?: number },
) {
  const q = opts.q?.trim().slice(0, 200);
  const [events, actions] = await Promise.all([
    db.entryEvent.findMany({
      where: {
        campaignId,
        ...(opts.method ? methodWhere(opts.method) : {}),
        ...(q ? { entrant: entrantSearchWhere(q) ?? {} } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: opts.take ?? 100,
      include: {
        entrant: {
          select: { id: true, email: true, name: true, status: true },
        },
        orderLog: { select: { orderName: true } },
      },
    }),
    db.entryAction.findMany({
      where: { campaignId },
      select: { id: true, type: true, label: true, config: true },
    }),
  ]);
  const voided = await voidedEvents(
    campaignId,
    events.map((e) => e.id),
  );
  return events.map((e) => ({
    id: e.id,
    at: e.createdAt,
    entrant: e.entrant,
    what: describeEvent(e, actions),
    entries: e.entries,
    canVoid: e.entries > 0 && !e.dedupeKey?.startsWith("void:"),
    voided: voided.has(e.id) ? voided.get(e.id) || "no reason given" : null,
  }));
}

export type ActivityRow = Awaited<ReturnType<typeof activityFeed>>[number];
