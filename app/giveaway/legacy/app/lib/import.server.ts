import { randomBytes } from "node:crypto";
import db from "../db.server";
import { isValidEmailSyntax, normalizeEmail } from "./bot/email";
import { parseCsv } from "./csv";

// Entrant import for migrating a running giveaway (e.g. from GiveawayNinja).
// Imported people start ACTIVE with one IMPORT ledger event carrying their
// entries. The event's dedupe key is "import:<normalized email>", so running
// the same file again adds nothing.

const HEADER_ALIASES = {
  email: [
    "email",
    "email address",
    "e-mail",
    "e-mail address",
    "customer email",
  ],
  name: ["name", "full name", "customer name", "entrant name", "entrant"],
  firstName: ["first name", "firstname", "first_name"],
  lastName: ["last name", "lastname", "last_name"],
  entries: [
    "entries",
    "total entries",
    "entry count",
    "points",
    "total points",
    "score",
    "tickets",
  ],
  consent: [
    "accepts marketing",
    "marketing consent",
    "consent",
    "subscribed",
    "opted in",
    "optinnewsletter", // GiveawayNinja export header "OptinNewsletter"
  ],
} as const;

type Column = keyof typeof HEADER_ALIASES;

const clean = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .replace(/[^a-z0-9 -]/g, "");

/** Index of each known column in the header row (case and spacing insensitive). */
export function mapHeaders(header: string[]) {
  const cleaned = header.map(clean);
  const map: Partial<Record<Column, number>> = {};
  for (const [col, aliases] of Object.entries(HEADER_ALIASES) as [
    Column,
    readonly string[],
  ][]) {
    const idx = cleaned.findIndex((h) => aliases.some((a) => clean(a) === h));
    if (idx >= 0) map[col] = idx;
  }
  return map;
}

export interface ImportRow {
  line: number;
  email: string;
  emailNormalized: string;
  name: string | null;
  entries: number;
  consent: boolean;
}

export interface ParsedImport {
  rows: ImportRow[];
  errors: { line: number; message: string }[];
  duplicates: number;
  columns: Partial<Record<Column, number>>;
}

const TRUTHY = new Set(["yes", "y", "true", "1", "subscribed", "opted in"]);

/** Parses and validates an export file. Pure; touches no database. */
export function parseImport(text: string): ParsedImport {
  const [header, ...data] = parseCsv(text);
  if (!header) {
    return {
      rows: [],
      errors: [{ line: 1, message: "The file is empty." }],
      duplicates: 0,
      columns: {},
    };
  }
  const columns = mapHeaders(header);
  if (columns.email === undefined) {
    return {
      rows: [],
      errors: [
        { line: 1, message: 'No "Email" column found in the header row.' },
      ],
      duplicates: 0,
      columns,
    };
  }

  const cell = (r: string[], c: Column) =>
    columns[c] === undefined ? "" : (r[columns[c]!] ?? "").trim();
  const byEmail = new Map<string, ImportRow>();
  const errors: ParsedImport["errors"] = [];
  let duplicates = 0;

  data.forEach((r, i) => {
    const line = i + 2;
    const email = cell(r, "email");
    if (!isValidEmailSyntax(email)) {
      errors.push({ line, message: `Invalid email "${email}"` });
      return;
    }
    const rawEntries = cell(r, "entries").replace(/,/g, "");
    const entries = rawEntries === "" ? 0 : Number(rawEntries);
    if (!Number.isInteger(entries) || entries < 0) {
      errors.push({ line, message: `Invalid entries "${rawEntries}"` });
      return;
    }
    const name =
      cell(r, "name") ||
      [cell(r, "firstName"), cell(r, "lastName")].filter(Boolean).join(" ") ||
      null;
    const emailNormalized = normalizeEmail(email);
    const row: ImportRow = {
      line,
      email,
      emailNormalized,
      name,
      entries,
      consent: TRUTHY.has(cell(r, "consent").toLowerCase()),
    };
    const prev = byEmail.get(emailNormalized);
    if (prev) {
      // Aliases of one inbox (or a repeated row): keep the larger entry count.
      duplicates++;
      if (row.entries > prev.entries)
        byEmail.set(emailNormalized, { ...row, line: prev.line });
      return;
    }
    byEmail.set(emailNormalized, row);
  });

  return { rows: [...byEmail.values()], errors, duplicates, columns };
}

// One key per imported total, so re-importing the same file is a no-op while
// a newer export with a higher total only adds the difference. Totals never
// go down: entries earned here after the switch are never removed.
export const importDedupeKey = (emailNormalized: string, total: number) =>
  `import:${emailNormalized}:${total}`;

const CHUNK = 500;
const chunks = <T>(items: T[]) =>
  Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) =>
    items.slice(i * CHUNK, (i + 1) * CHUNK),
  );

type Db = Pick<typeof db, "entrant" | "entryEvent">;

/** Entries already imported per normalized email for these rows. */
async function importedSoFar(client: Db, campaignId: string, emails: string[]) {
  const events = await client.entryEvent.findMany({
    where: {
      campaignId,
      source: "IMPORT",
      entrant: { emailNormalized: { in: emails } },
    },
    select: { entries: true, entrant: { select: { emailNormalized: true } } },
  });
  const sums = new Map<string, number>();
  for (const e of events) {
    const k = e.entrant.emailNormalized;
    sums.set(k, (sums.get(k) ?? 0) + e.entries);
  }
  return sums;
}

/** What an import would do, without writing anything. */
export async function previewImport(campaignId: string, parsed: ParsedImport) {
  let existing = 0;
  let alreadyImported = 0;
  let entriesToAdd = 0;
  for (const part of chunks(parsed.rows)) {
    const emails = part.map((r) => r.emailNormalized);
    const [entrants, sums] = await Promise.all([
      db.entrant.findMany({
        where: { campaignId, emailNormalized: { in: emails } },
        select: { emailNormalized: true },
      }),
      importedSoFar(db, campaignId, emails),
    ]);
    existing += entrants.length;
    for (const r of part) {
      const delta = r.entries - (sums.get(r.emailNormalized) ?? 0);
      if (delta > 0) entriesToAdd += delta;
      else if (sums.has(r.emailNormalized)) alreadyImported++;
    }
  }
  return {
    rows: parsed.rows.length,
    newEntrants: parsed.rows.length - existing,
    existingEntrants: existing,
    alreadyImported,
    entriesToAdd,
  };
}

/**
 * Creates missing entrants and tops up their IMPORT entries to the CSV total.
 * Existing entrants keep their status and details.
 */
export async function runImport(campaignId: string, parsed: ParsedImport) {
  let created = 0;
  let awarded = 0;
  let entries = 0;
  for (const part of chunks(parsed.rows)) {
    await db.$transaction(async (tx) => {
      const now = new Date();
      const made = await tx.entrant.createMany({
        data: part.map((r) => ({
          campaignId,
          email: r.email,
          emailNormalized: r.emailNormalized,
          name: r.name,
          status: "ACTIVE" as const,
          verifiedAt: now,
          marketingConsent: r.consent,
          referralCode: randomBytes(5).toString("base64url"),
        })),
        skipDuplicates: true,
      });
      created += made.count;

      const emails = part.map((r) => r.emailNormalized);
      const [entrants, sums] = await Promise.all([
        tx.entrant.findMany({
          where: { campaignId, emailNormalized: { in: emails } },
          select: { id: true, emailNormalized: true },
        }),
        importedSoFar(tx, campaignId, emails),
      ]);
      const idByEmail = new Map(entrants.map((e) => [e.emailNormalized, e.id]));
      const events = part
        .map((r) => ({
          r,
          delta: r.entries - (sums.get(r.emailNormalized) ?? 0),
        }))
        .filter(({ r, delta }) => delta > 0 && idByEmail.has(r.emailNormalized))
        .map(({ r, delta }) => ({
          campaignId,
          entrantId: idByEmail.get(r.emailNormalized)!,
          source: "IMPORT" as const,
          entries: delta,
          note: `imported from CSV (total ${r.entries})`,
          dedupeKey: importDedupeKey(r.emailNormalized, r.entries),
        }));
      // The (campaignId, dedupeKey) unique index makes a concurrent re-run a no-op.
      const added = await tx.entryEvent.createManyAndReturn({
        data: events,
        skipDuplicates: true,
        select: { entries: true },
      });
      awarded += added.length;
      entries += added.reduce((s, e) => s + e.entries, 0);
    });
  }
  return { created, awarded, entries };
}
