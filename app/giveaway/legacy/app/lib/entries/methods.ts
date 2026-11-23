import type { ActionType, EntrySource } from "@prisma/client";
import { isArchived } from "./actions";

// "How did people earn their entries": one row per entry action (by its own label, so
// Whatnot, Discord and Instagram follows stay apart), plus purchases, imports, manual
// adjustments and rollbacks.

export interface MethodAction {
  id: string;
  type: ActionType;
  label: string;
  config: unknown;
}

/** One group of entry events, keyed by methodKey(). */
export interface MethodTotals {
  key: string;
  /** Net entries (rollbacks are negative). */
  entries: number;
  /** Events that awarded entries. */
  times: number;
  /** Entrants with at least one awarding event. */
  people: number;
}

export interface MethodRow extends MethodTotals {
  label: string;
  /** Share of all net entries, 0 to 1. */
  share: number;
}

const OTHER: Record<string, string> = {
  purchase: "Purchases",
  import: "Imported (GiveawayNinja)",
  adjustment: "Manual Adjustments",
  rollback: "Refunds And Clawbacks",
};

/** Actions and referrals group by their action; everything else by source. */
export function methodKey(source: EntrySource, actionId: string | null) {
  return actionId && (source === "ACTION" || source === "REFERRAL")
    ? `action:${actionId}`
    : source.toLowerCase();
}

export function methodRows(
  totals: MethodTotals[],
  actions: MethodAction[],
): MethodRow[] {
  const byKey = new Map(totals.map((t) => [t.key, t]));
  const empty = (key: string) => ({ key, entries: 0, times: 0, people: 0 });
  const rows: Omit<MethodRow, "share">[] = [];
  // Every live action shows, even before anyone completes it; removed ones only if used.
  for (const a of actions) {
    const key = `action:${a.id}`;
    const t = byKey.get(key);
    byKey.delete(key);
    if (!t && isArchived(a)) continue;
    rows.push({
      ...(t ?? empty(key)),
      label: isArchived(a) ? `${a.label} (Removed)` : a.label,
    });
  }
  for (const [key, label] of Object.entries(OTHER)) {
    const t = byKey.get(key);
    byKey.delete(key);
    if (t) rows.push({ ...t, label });
  }
  // Events whose action was deleted outright.
  const orphans = [...byKey.values()];
  if (orphans.length)
    rows.push({
      key: "removed",
      label: "Removed Actions",
      entries: orphans.reduce((s, t) => s + t.entries, 0),
      times: orphans.reduce((s, t) => s + t.times, 0),
      people: Math.max(...orphans.map((t) => t.people)),
    });
  const total = rows.reduce((s, r) => s + Math.max(0, r.entries), 0);
  return rows.map((r) => ({
    ...r,
    share: total && r.entries > 0 ? r.entries / total : 0,
  }));
}

/** A label for one entry event in an entrant's history. */
export function methodLabel(
  source: EntrySource,
  actionId: string | null,
  actions: MethodAction[],
) {
  const key = methodKey(source, actionId);
  if (key.startsWith("action:"))
    return actions.find((a) => a.id === actionId)?.label ?? "Removed Action";
  return OTHER[key] ?? source.toLowerCase();
}
