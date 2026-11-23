// Store-local date handling. Admin forms send "YYYY-MM-DDTHH:mm" with no
// offset; it means wall-clock time in the campaign's timezone.

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function offsetMs(utc: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(utc)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - utc.getTime();
}

/** Parses a datetime-local value in `timeZone`. Returns undefined if blank, null if invalid. */
export function parseLocalDateTime(
  value: string,
  timeZone: string,
): Date | null | undefined {
  if (!value) return undefined;
  const m = LOCAL_RE.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  // Two passes settle the offset across DST boundaries.
  let result = new Date(guess.getTime() - offsetMs(guess, timeZone));
  result = new Date(guess.getTime() - offsetMs(result, timeZone));
  return Number.isNaN(result.getTime()) ? null : result;
}

/** Formats a Date as a datetime-local value in `timeZone`. */
export function toLocalInput(date: Date | null | undefined, timeZone: string) {
  if (!date) return "";
  const local = new Date(date.getTime() + offsetMs(date, timeZone));
  return local.toISOString().slice(0, 16);
}

export function formatInZone(date: Date | string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}
