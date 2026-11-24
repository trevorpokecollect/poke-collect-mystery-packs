import { parseLocalDateTime } from "./time";

export const DRAW_ZONE = "America/Chicago";
export const PRIZE = 10_000;
/** Residents of these states cannot enter Cardbit prize promotions (Official Rules, Eligibility). */
export const EXCLUDED_STATES = ["AL", "FL", "NY"] as const;
export const STATES =
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY"
    .split(" ")
    .filter((s) => !(EXCLUDED_STATES as readonly string[]).includes(s));
export const SOCIAL = {
  whatnot: {
    label: "Whatnot",
    entries: 100,
    href: "https://whatnot.com/invite/pokecollectcards",
  },
  facebook: {
    label: "Facebook",
    entries: 50,
    href: "https://www.facebook.com/profile.php?id=61596993114628",
  },
  instagram: {
    label: "Instagram",
    entries: 50,
    href: "https://www.instagram.com/cardbitshop/",
  },
} as const;
export type Social = keyof typeof SOCIAL;
export const isSocial = (name: unknown): name is Social =>
  typeof name === "string" && Object.hasOwn(SOCIAL, name);

function dayOffset(day: string, offset: number) {
  const value = new Date(day + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}
export function drawWindow(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: DRAW_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  let day = [parts.year, parts.month, parts.day].join("-");
  const close = (key: string) => parseLocalDateTime(key + "T20:00", DRAW_ZONE)!;
  if (now >= close(day)) day = dayOffset(day, 1);
  return { day, opensAt: close(dayOffset(day, -1)), closesAt: close(day) };
}
export function paidEntries(principal: number) {
  return Number.isSafeInteger(principal) && principal > 0
    ? Math.floor(principal / 100)
    : 0;
}
export function rulesLink(input: unknown) {
  const value = String(input ?? "").trim();
  if (!value) return "";
  const url = new URL(value, "https://cardbit.com");
  if (
    url.origin !== "https://cardbit.com" ||
    url.username ||
    url.password ||
    url.pathname === "/"
  )
    throw Error("Enter a Cardbit official rules page.");
  return url.toString();
}
export function entryRate(input: unknown) {
  const n = Number(input);
  if (
    input == null ||
    input === "" ||
    !Number.isSafeInteger(n) ||
    n < 0 ||
    n > 100000
  )
    throw Error("Enter a whole number from 0 to 100,000.");
  return n;
}
export function giveawayTotals(
  events: {
    customerId: string;
    kind: string;
    entries: number;
    voided: boolean;
  }[],
  eligible: Set<string>,
) {
  // A daily check-in or an accepted mail-in postcard enters the person in that drawing.
  const checked = new Set(
    events
      .filter((e) => !e.voided && (e.kind === "daily" || e.kind === "mail-in"))
      .map((e) => e.customerId),
  );
  const totals = new Map<string, number>();
  for (const e of events)
    if (!e.voided && checked.has(e.customerId) && eligible.has(e.customerId))
      totals.set(e.customerId, (totals.get(e.customerId) || 0) + e.entries);
  return [...totals]
    .filter(([, entries]) => entries > 0)
    .map(([entrantId, entries]) => ({ entrantId, entries }));
}
