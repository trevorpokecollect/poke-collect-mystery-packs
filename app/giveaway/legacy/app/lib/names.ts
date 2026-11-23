// Safe to use in the browser (winners.ts needs node:crypto).

/** Public display name: first name and last initial, e.g. "Ash K." */
export function publicName(name: string | null, email: string) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return `${email.charAt(0).toUpperCase()}.`;
  const first = parts[0];
  const last =
    parts.length > 1 ? ` ${parts.at(-1)!.charAt(0).toUpperCase()}.` : "";
  return `${first}${last}`;
}
