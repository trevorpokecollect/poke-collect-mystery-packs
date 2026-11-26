// Instant chat filter (layer 1 of chat auto-moderation, Trevor 2026-11-26). Runs on every message before it posts,
// with no network call. It catches the obvious cases, including the usual disguises (leetspeak, spacing, "dot com",
// spelled-out phone numbers). Anything subtler (harassment, scams, "DM me for trades" in other words) is left to the
// AI check in chat-moderation.server.ts.
//
// A block with `strike: true` counts toward an automatic mute (hate slurs and threats). Other blocks only explain
// the rule, because people paste links or type in caps by accident.

export type FilterCategory = "hate" | "threat" | "link" | "contact" | "off_platform" | "spam" | "caps";
export type FilterHit = { category: FilterCategory; message: string; strike: boolean; severity: 1 | 2 | 3 };

const LEET: Record<string, string> = { "0": "o", "1": "i", "!": "i", "|": "i", "3": "e", "4": "a", "@": "a", "5": "s", $: "s", "7": "t", "8": "b", "9": "g", "+": "t" };

/** Lowercase, accents stripped, leetspeak mapped. Keeps spaces so word rules still work. */
export function normalize(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[0-9!|@$+]/g, (c) => LEET[c] ?? c);
}
/**
 * Disguise-proof tokens: letters only inside each word ("n.i.g" → "nig"), spaced-out single letters joined back
 * ("n i g g a" → "nigga"), and runs of 3+ of a letter cut to 2 ("niggggga" → "nigga"). Words are never joined to
 * their neighbours, so innocent phrases ("pick ike", "wet backpack") can't form a slur.
 */
export function tokens(normalized: string) {
  const out: string[] = [];
  let spaced = "";
  for (const raw of normalized.split(/\s+/)) {
    const t = raw.replace(/[^a-z]/g, "").replace(/(.)\1{2,}/g, "$1$1");
    if (t.length === 1) { spaced += t; continue; }
    if (spaced) { out.push(spaced.replace(/(.)\1{2,}/g, "$1$1")); spaced = ""; }
    if (t) out.push(t);
  }
  if (spaced) out.push(spaced.replace(/(.)\1{2,}/g, "$1$1"));
  return out;
}

// Hate slurs. INSIDE entries are distinctive enough to match inside a longer word ("xniggerx"); WHOLE entries are
// short and only match a whole word (so "raccoon", "spice", "cocoon", "Nigeria" and "Scunthorpe" pass).
const SLURS_INSIDE = ["nigger", "nigga", "niggah", "faggot", "fagot", "tranny", "trannie", "sandnigger", "towelhead", "wetback"];
const SLURS_WHOLE = new Set(["fag", "fags", "spic", "spics", "coon", "coons", "gook", "gooks", "chink", "chinks", "dyke", "dykes", "paki", "pakis", "beaner", "beaners", "kike", "kikes", "retard", "retards", "retarded", "nig", "nigs"]);
// Threats aimed at someone.
const THREAT = /\b(kys|kill (your ?self|ur ?self|yo ?self|urslf)|hang (your ?self|ur ?self)|(you|u) should (die|kill)|i('| wi)?ll (kill|find|dox+|hurt) (you|u)|i know where (you|u) live)\b/;

// Off-site trading and payments. There are no private messages on Cardbit, so "DM me" always means elsewhere.
const OFF_PLATFORM = new RegExp(
  [
    "\\bcash ?app\\b", "\\bvenmo\\b", "\\bzelle\\b", "\\bpay ?pal\\b", "\\bapple ?pay\\b", "\\bgoogle ?pay\\b", "\\bcrypto\\b", "\\bbitcoin\\b", "\\bbtc\\b", "\\busdt\\b",
    "\\btelegram\\b", "\\bwhats ?app\\b", "\\bsnap ?chat\\b", "\\bsnap me\\b", "\\bkik me\\b", "\\bsignal me\\b",
    "\\b(dm|pm|message|msg|inbox|text|call|hit) (me|meh)\\b", "\\bhmu\\b", "\\bdms? (are )?open\\b", "\\bcheck (my|ma) (dms?|inbox|bio|profile)\\b",
    "\\badd me (on|at)\\b", "\\bfollow me (on|at)\\b", "\\bmy (ig|insta|instagram|tiktok|twitter|discord|snap|fb|facebook|ebay|whatnot|mercari) ?(is|@|:)",
    "\\b(on|at|my) (ig|insta|instagram|tiktok|ebay|mercari|whatnot|facebook marketplace)\\b",
  ].join("|"),
);
const CASHTAG = /(^|\s)\$[a-z][a-z0-9_-]{2,}/;

// Links in disguise: "cards dot shop", "cards . shop", "cards(.)shop", "discord gg/abc".
const TLD = "com|net|org|gg|io|co|us|shop|store|xyz|me|ly|app|link|tv|live|site|info|biz|ru|cc|to|ai|dev|online";
const LINK = new RegExp(`(https?:\\/\\/|www\\.|\\b[a-z0-9-]+\\.(${TLD})\\b|discord\\s*\\.?\\s*gg|\\bbit\\.ly\\b|\\bt\\.me\\b)`, "i");
const unhideDots = (s: string) =>
  s
    .replace(/\s*[([{]\s*(dot|\.)\s*[)\]}]\s*/gi, ".")
    .replace(/\s+(dot|d0t)\s+/gi, ".")
    .replace(/\s*\.\s*/g, ".");
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const EMAIL_SPOKEN = /\b[a-z0-9._-]+\s*(\(|\[)?\s*at\s*(\)|\])?\s*(gmail|yahoo|hotmail|outlook|icloud|aol|proton|protonmail)\b/i;
const PHONE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const NUMBER_WORDS: Record<string, string> = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
/** Ten or more digits in one stretch, counting spelled-out digits and ignoring spaces, dots, dashes and brackets. */
function spelledPhone(lower: string) {
  const digits = lower.replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => NUMBER_WORDS[w]);
  return /(\d[\s.\-()]*){10,}/.test(digits);
}

const hit = (category: FilterCategory, message: string, strike = false, severity: 1 | 2 | 3 = 1): FilterHit => ({ category, message, strike, severity });

/** Returns the first rule a message breaks, or null when it may post (pending the AI check). */
export function filterMessage(body: string): FilterHit | null {
  const lower = body.toLowerCase();
  const norm = normalize(body);
  const toks = tokens(norm);
  const words = toks.join(" ");

  if (toks.some((t) => SLURS_WHOLE.has(t) || SLURS_INSIDE.some((w) => t.includes(w)))) return hit("hate", "That message wasn't posted. Hate speech isn't allowed in chat.", true, 3);
  if (THREAT.test(words)) return hit("threat", "That message wasn't posted. Threats aren't allowed in chat.", true, 3);

  if (LINK.test(body) || LINK.test(unhideDots(lower))) return hit("link", "Links aren't allowed in chat.");
  if (EMAIL.test(body) || EMAIL_SPOKEN.test(lower) || PHONE.test(body) || spelledPhone(lower))
    return hit("contact", "Contact details aren't allowed in chat. Keep trades on Cardbit.");
  if (OFF_PLATFORM.test(lower) || CASHTAG.test(lower)) return hit("off_platform", "Keep trades and payments on Cardbit. Off-site deals, payment apps and DMs aren't allowed in chat.");

  if (/(.)\1{9,}/u.test(body)) return hit("spam", "Too many repeated characters.");
  const plainWords = lower.split(/\s+/).filter((t) => t.length > 1);
  if (plainWords.length >= 6) {
    const counts = new Map<string, number>();
    for (const t of plainWords) counts.set(t, (counts.get(t) ?? 0) + 1);
    if (Math.max(...counts.values()) >= Math.max(6, plainWords.length * 0.6)) return hit("spam", "That looks like spam. Try saying it once.");
  }
  const letters = body.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 16 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.75) return hit("caps", "Easy on the caps.");
  return null;
}
