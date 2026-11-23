// Entrant search for the admin: every word must appear in the email or the name, case
// insensitive, so "ash ketchum", "ketchum", "ash@" and "gmail" all work. Pure, so it's tested.

const MAX_WORDS = 5;

export function entrantSearchWhere(raw: string | null | undefined) {
  const words = (raw ?? "")
    .trim()
    .slice(0, 200)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_WORDS);
  if (!words.length) return null;
  return {
    AND: words.map((w) => ({
      OR: [
        { email: { contains: w, mode: "insensitive" as const } },
        { name: { contains: w, mode: "insensitive" as const } },
      ],
    })),
  };
}
