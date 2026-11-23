// Email hygiene: canonical form for de-duplication plus disposable-domain checks.

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);
// Providers where "+tag" is an alias of the same inbox.
const PLUS_ALIAS_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "fastmail.com",
  "yahoo.com",
]);

// A starter list of throwaway providers. Extend via DISPOSABLE_EMAIL_DOMAINS (comma-separated).
const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "sharklasers.com",
  "mailinator.com",
  "maildrop.cc",
  "temp-mail.org",
  "tempmail.com",
  "tempmailo.com",
  "throwawaymail.com",
  "yopmail.com",
  "getnada.com",
  "trashmail.com",
  "dispostable.com",
  "fakeinbox.com",
  "mintemail.com",
  "mohmal.com",
  "emailondeck.com",
  "burnermail.io",
  "spamgourmet.com",
  "mail.tm",
  "moakt.com",
  "tmail.ws",
  "1secmail.com",
]);

// Strict enough that Resend accepts every address that passes (it 422s on odd ones, which used to
// surface as a 500 at sign-up): plain ASCII local part without leading, trailing or double dots, and
// a domain of letter/digit/hyphen labels ending in a letters-only TLD.
const EMAIL_RE =
  /^(?!\.)(?!.*\.\.)[A-Za-z0-9._%+'-]+(?<!\.)@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export function isValidEmailSyntax(email: string) {
  return EMAIL_RE.test(email.trim());
}

export function normalizeEmail(email: string): string {
  const [rawLocal, rawDomain] = email.trim().toLowerCase().split("@");
  if (!rawLocal || !rawDomain) return email.trim().toLowerCase();
  const domain = rawDomain === "googlemail.com" ? "gmail.com" : rawDomain;
  let local = rawLocal;
  if (PLUS_ALIAS_DOMAINS.has(domain)) local = local.split("+")[0];
  if (GMAIL_DOMAINS.has(domain)) local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export function emailDomain(email: string) {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

export function isDisposableEmail(
  email: string,
  extra: string[] = envDisposableDomains(),
) {
  const domain = emailDomain(email);
  if (!domain) return false;
  const all = extra.length
    ? new Set([...DISPOSABLE_DOMAINS, ...extra])
    : DISPOSABLE_DOMAINS;
  // Match subdomains too (e.g. "abc.mailinator.com").
  return [...all].some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** Heuristic for bot-generated local parts like "jdk38fh2k9x" or "user84729163". */
export function looksGenerated(email: string) {
  const local = email.split("@")[0] ?? "";
  const digits = (local.match(/\d/g) ?? []).length;
  if (local.length >= 8 && digits / local.length >= 0.5) return true;
  // Long runs of consonants rarely appear in real names.
  return /[bcdfghjklmnpqrstvwxz]{6,}/i.test(local);
}

function envDisposableDomains() {
  return (process.env.DISPOSABLE_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

// Common misspellings of the big email providers. People who type these never get the
// verification code or a winner email, so the form asks them to fix it.
const DOMAIN_TYPOS: Record<string, string> = {
  "gmail.con": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.om": "gmail.com",
  "gmail.comm": "gmail.com",
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gmail.cmo": "gmail.com",
  "yahoo.con": "yahoo.com",
  "yahoo.co": "yahoo.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "yhoo.com": "yahoo.com",
  "hotmail.con": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "hotmial.com": "hotmail.com",
  "hotmal.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "outlook.con": "outlook.com",
  "outlook.co": "outlook.com",
  "outlok.com": "outlook.com",
  "icloud.con": "icloud.com",
  "icloud.co": "icloud.com",
  "iclould.com": "icloud.com",
  "icoud.com": "icloud.com",
  "aol.con": "aol.com",
  "aol.co": "aol.com",
  "comcast.con": "comcast.net",
  "att.con": "att.net",
};

/** The corrected address when the domain is a known typo (any ".con" becomes ".com"), else null. */
export function suggestEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const domain = email.slice(at + 1).toLowerCase();
  const fixed =
    DOMAIN_TYPOS[domain] ??
    (domain.endsWith(".con") ? `${domain.slice(0, -4)}.com` : null);
  return fixed ? `${email.slice(0, at)}@${fixed}` : null;
}
