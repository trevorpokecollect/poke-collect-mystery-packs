import type { ActionType, EntrySource } from "@prisma/client";
import { DEFAULT_SMS_DISCLOSURE } from "../phone";

// Pure helpers for storefront actions: what the widget may see, answer matching,
// leaderboard names and the "my entries" breakdown. Server code lives in actions.server.ts.

type Config = Record<string, unknown>;

interface ActionLike {
  id: string;
  type: ActionType;
  label: string;
  entries: number;
  config: unknown;
  mandatory: boolean;
  repeatable: boolean;
}

const asConfig = (c: unknown): Config =>
  c && typeof c === "object" && !Array.isArray(c) ? (c as Config) : {};
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Merchants archive an action instead of deleting it, so past entries keep their label. */
export const isArchived = (a: { config: unknown }) =>
  asConfig(a.config).archived === true;

// Signing up, referrals and the mail-in entry never block anything, even when marked required.
const NOT_GATING: ActionType[] = ["SIGNUP", "REFERRAL", "ALTERNATE_ENTRY"];

/** Actions an entrant must complete to be in the draw (and before the other tasks unlock). */
export const requiredActions = <T extends ActionLike>(actions: T[]) =>
  actions.filter(
    (a) => a.mandatory && !isArchived(a) && !NOT_GATING.includes(a.type),
  );

// Awarded by the server on its own, so the widget never offers them as buttons.
const AUTOMATIC: ActionType[] = ["SIGNUP"];

/** Actions the widget lists, mandatory ones first (keeping the merchant's order otherwise). */
export function visibleActions<T extends ActionLike>(actions: T[]) {
  return actions
    .filter((a) => !isArchived(a) && !AUTOMATIC.includes(a.type))
    .map((a, i) => ({ a, i }))
    .sort((x, y) => Number(y.a.mandatory) - Number(x.a.mandatory) || x.i - y.i)
    .map(({ a }) => a);
}

/** The config fields a shopper may see. Secret codes and quiz answers never leave the server. */
export function publicConfig(type: ActionType, raw: unknown) {
  const c = asConfig(raw);
  switch (type) {
    case "SOCIAL_FOLLOW":
    case "VISIT_URL":
      return { url: str(c.url) ?? null };
    case "WATCH_VIDEO":
      return {
        url: str(c.url) ?? null,
        seconds: typeof c.seconds === "number" ? c.seconds : 0,
      };
    case "SOCIAL_SHARE":
      return { network: str(c.network) ?? "any" };
    case "POLL":
      return {
        question: str(c.question) ?? "",
        options: Array.isArray(c.options)
          ? c.options.filter((o): o is string => typeof o === "string")
          : [],
      };
    case "QUESTION":
      return { question: str(c.question) ?? "", quiz: !!str(c.answer) };
    case "ALTERNATE_ENTRY":
      return { instructions: str(c.instructions) ?? "" };
    case "SMS_OPTIN":
      return { disclosure: str(c.disclosure) || DEFAULT_SMS_DISCLOSURE };
    default:
      return {};
  }
}

/** Daily Task display fields (no secrets): see app/lib/daily-tasks.ts. */
function taskConfig(raw: unknown) {
  const c = asConfig(raw);
  if (c.daily !== true) return {};
  const s = asConfig(c.schedule);
  return {
    daily: true,
    confirm: str(c.confirm) ?? null,
    live: c.live === true,
    // Checked against another app (buylist, Vault Market), not the honor system.
    verified: c.verifyBuylist === true || c.verifyMarketListing === true,
    schedule: Array.isArray(s.days)
      ? { days: s.days, start: str(s.start), end: str(s.end) }
      : null,
  };
}

export function publicAction(a: ActionLike) {
  const config = { ...publicConfig(a.type, a.config), ...taskConfig(a.config) };
  return {
    id: a.id,
    type: a.type,
    label: a.label,
    entries: a.entries,
    mandatory: a.mandatory,
    repeatable: a.repeatable,
    // Kept for widgets cached from before `config` existed.
    url: "url" in config ? config.url : null,
    config,
  };
}

const normalizeAnswer = (s: string) =>
  s.trim().replace(/\s+/g, " ").toLowerCase();

/** Quiz answers match ignoring case, surrounding spaces and repeated inner spaces. */
export const answerMatches = (given: string, expected: string) =>
  normalizeAnswer(given) !== "" &&
  normalizeAnswer(given) === normalizeAnswer(expected);

/** Finds the poll option a shopper picked, tolerating case and spacing differences. */
export function matchPollOption(options: string[], given: string) {
  return options.find((o) => normalizeAnswer(o) === normalizeAnswer(given));
}

/** "Ash Ketchum" -> "Ash K.", "misty" -> "Misty". Falls back to the email's first part. */
export function leaderboardName(name: string | null, email: string) {
  const source = name?.trim() || email.split("@")[0].replace(/[._+-]+/g, " ");
  const parts = source.split(/\s+/).filter(Boolean);
  if (!parts.length) return "Entrant";
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const first = cap(parts[0].slice(0, 20));
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

export interface BreakdownEvent {
  source: EntrySource;
  entries: number;
  dedupeKey: string | null;
  orderLogId: string | null;
}

/** Groups an entrant's ledger into the rows the widget shows under "My entries". */
export function entriesBreakdown(events: BreakdownEvent[]) {
  const rows = { signup: 0, actions: 0, purchases: 0, referrals: 0, other: 0 };
  for (const e of events) {
    const key = e.dedupeKey ?? "";
    if (key.startsWith("signup:")) rows.signup += e.entries;
    else if (e.source === "PURCHASE" || e.orderLogId)
      rows.purchases += e.entries;
    else if (e.source === "REFERRAL" || key.startsWith("referral"))
      rows.referrals += e.entries;
    else if (e.source === "ACTION") rows.actions += e.entries;
    else rows.other += e.entries;
  }
  return rows;
}
