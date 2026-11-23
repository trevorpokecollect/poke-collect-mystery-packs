// Email domains and bot farms. In October 2026 a farm signed up ~10,000 fake entrants (made-up
// names on throwaway catch-all domains like putterkickz.com, rotating every day or two) and won
// two daily draws. Known farm domains are refused outright; any other domain that isn't a big
// mail provider and suddenly sends many sign-ups is refused too (see DOMAIN_BURST).

/** Farm domains seen so far. More can be added with the BLOCKED_EMAIL_DOMAINS env var. */
export const BLOCKED_DOMAINS = [
  "brightwingmail.com",
  "firstlineinbox.com",
  "firstpostmail.com",
  "google-o.com",
  "hottermails.com",
  "mailrelayco.com",
  "northstarinbox.com",
  "oakmailhub.com",
  "putterkickz.com",
  "relaypointinc.com",
  "summitcloudmail.com",
  "umberinbox.com",
  "unioninbox.com",
];

// Providers where thousands of real people share a domain, so volume says nothing.
const COMMON_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "rocketmail.com",
  "myyahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "aim.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.us",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "comcast.net",
  "att.net",
  "sbcglobal.net",
  "bellsouth.net",
  "verizon.net",
  "cox.net",
  "charter.net",
  "spectrum.net",
  "optonline.net",
  "optimum.net",
  "earthlink.net",
  "frontier.com",
  "windstream.net",
  "centurylink.net",
  "q.com",
]);

/** Sign-ups from one uncommon domain within DOMAIN_BURST.hours that get refused. */
export const DOMAIN_BURST = { count: 8, hours: 24 };

export function isCommonDomain(domain: string) {
  const d = domain.toLowerCase();
  // Country variants of the big providers (hotmail.fr, yahoo.co.uk, outlook.de …).
  return (
    COMMON_DOMAINS.has(d) ||
    /^(hotmail|outlook|live|yahoo|gmail|icloud|aol|gmx|web|orange|free|libero|t-online)\.[a-z.]+$/.test(
      d,
    ) ||
    /\.(edu|gov|mil)$/.test(d) ||
    /\.k12\.[a-z]{2}\.us$/.test(d)
  );
}

export function isBlockedDomain(
  domain: string,
  extra: string[] = envBlockedDomains(),
) {
  const d = domain.toLowerCase();
  return [...BLOCKED_DOMAINS, ...extra].some(
    (b) => d === b || d.endsWith(`.${b}`),
  );
}

function envBlockedDomains() {
  return (process.env.BLOCKED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}
