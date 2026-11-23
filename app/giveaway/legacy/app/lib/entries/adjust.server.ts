import db from "../../db.server";
import { normalizeEmail } from "../bot/email";
import { entrantTotal } from "./ledger.server";

// "Add Entries" in the admin: a manual ledger event (source ADJUSTMENT) for fixing entries that
// didn't attach (an order placed with a different email, a task that didn't register...).
// A negative number takes entries away. Like imports, it counts in the daily draw of the day
// it's added. Never edits existing events: the ledger stays append-only.

export const MAX_ADJUSTMENT = 100_000;

export function parseAdjustment(raw: unknown): number | string {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isInteger(n) || n === 0)
    return "Enter a whole number of entries (use a minus sign to take entries away).";
  if (Math.abs(n) > MAX_ADJUSTMENT)
    return `Add at most ${MAX_ADJUSTMENT.toLocaleString()} entries at a time.`;
  return n;
}

/** Adds (or with a negative number removes) entries for one entrant, by id or email. */
export async function addEntries(input: {
  campaignId: string;
  entrantId?: string;
  email?: string;
  entries: unknown;
  note?: string;
}): Promise<
  | {
      ok: true;
      entrantId: string;
      label: string;
      entries: number;
      total: number;
    }
  | { error: string }
> {
  const entries = parseAdjustment(input.entries);
  if (typeof entries === "string") return { error: entries };
  const email = input.email?.trim();
  const entrant = input.entrantId
    ? await db.entrant.findFirst({
        where: { id: input.entrantId, campaignId: input.campaignId },
      })
    : email
      ? await db.entrant.findUnique({
          where: {
            campaignId_emailNormalized: {
              campaignId: input.campaignId,
              emailNormalized: normalizeEmail(email),
            },
          },
        })
      : null;
  if (!entrant)
    return {
      error: email
        ? `No entrant with ${email} in this giveaway. They need to enter first.`
        : "Entrant not found.",
    };
  if (entrant.status === "DISQUALIFIED")
    return { error: "This entrant is disqualified. Reinstate them first." };
  const note = input.note?.trim().slice(0, 200) || null;
  await db.entryEvent.create({
    data: {
      campaignId: input.campaignId,
      entrantId: entrant.id,
      source: "ADJUSTMENT",
      entries,
      note,
    },
  });
  return {
    ok: true,
    entrantId: entrant.id,
    label: entrant.name || entrant.email,
    entries,
    total: await entrantTotal(entrant.id),
  };
}
