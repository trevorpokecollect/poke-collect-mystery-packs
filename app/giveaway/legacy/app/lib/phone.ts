// US mobile numbers for the SMS opt-in. Giveaways are US-only, so anything that isn't a
// valid North American number is rejected rather than guessed at.

/** "(555) 234-5678", "555.234.5678" or "+1 555 234 5678" -> "+15552345678"; null if invalid. */
export function normalizeUsPhone(input: string) {
  let digits = input.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  // Area codes and exchanges never start with 0 or 1, and N11 codes aren't assignable.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  if (digits[1] === "1" && digits[2] === "1") return null;
  return `+1${digits}`;
}

/** "+15552345678" -> "(555) 234-5678" for the admin. */
export function formatUsPhone(e164: string | null | undefined) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 ?? "");
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (e164 ?? "");
}

// Shown next to the opt-in box. Carriers and Klaviyo require the brand, that texts are
// recurring and automated, that consent isn't a condition of purchase, rates, frequency,
// HELP/STOP, and links to the terms and privacy policy (the widget adds those links).
export const DEFAULT_SMS_DISCLOSURE =
  "By checking this box, you agree to receive recurring automated marketing text messages (e.g. drops and giveaway alerts) from Cardbit at the number provided. Consent is not a condition of purchase or entry. Msg & data rates may apply. Msg frequency varies. Reply HELP for help and STOP to cancel.";
