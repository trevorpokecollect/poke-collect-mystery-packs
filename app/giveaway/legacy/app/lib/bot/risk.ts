// Turns individual bot signals into a 0-100 risk score and a policy decision.
// Pure functions so the scoring can be unit tested and explained in the admin UI.

export type SignalCode =
  | "turnstile_failed"
  | "turnstile_missing"
  | "disposable_email"
  | "generated_email"
  | "duplicate_email_alias"
  | "ip_burst"
  | "subnet_burst"
  | "device_reuse"
  | "datacenter_ip"
  | "honeypot"
  | "too_fast"
  | "self_referral"
  | "referral_ring"
  | "blocked_domain"
  | "domain_burst";

export interface Signal {
  code: SignalCode;
  detail?: string;
}

export const SIGNAL_WEIGHTS: Record<SignalCode, number> = {
  turnstile_failed: 100,
  // Server-side: a known bot-farm email domain, or an uncommon domain sending a flood of
  // sign-ups (app/lib/bot/domains.ts).
  blocked_domain: 100,
  domain_burst: 100,
  // No token, or one already used: a real person who submitted before the check finished, or
  // retried after an error. Enough to ask for an email code, not to refuse the entry.
  turnstile_missing: 20,
  // The hidden field filled in. Android autofill (Google, Samsung Pass) fills it for real people
  // and ignores autocomplete="off", so on its own it only asks for an email code.
  honeypot: 20,
  disposable_email: 60,
  self_referral: 60,
  device_reuse: 45,
  referral_ring: 45,
  // Several sign-ups from one connection in an hour. Phone carriers, iCloud Private Relay and
  // shared Wi-Fi put many real people behind one address, so on its own it only asks for an
  // email code; with a second warning sign it holds for review.
  ip_burst: 25,
  datacenter_ip: 30,
  too_fast: 30,
  duplicate_email_alias: 25,
  subnet_burst: 20,
  generated_email: 15,
};

/**
 * Which signal a failed Turnstile check raises. Only a token Cloudflare says is invalid blocks;
 * everything else (no token, a reused/expired one, or Cloudflare/our config failing) falls back
 * to the email code, so an outage or a missing secret never turns real people away.
 */
export function turnstileSignal(errorCodes: string[]): Signal {
  return {
    code: errorCodes.includes("invalid-input-response")
      ? "turnstile_failed"
      : "turnstile_missing",
    detail: errorCodes.join(","),
  };
}

export type Decision = "allow" | "verify" | "hold" | "block";

export interface RiskPolicy {
  /** Scores below this are allowed straight through (after email verification if required). */
  verifyAt: number;
  /** Scores at or above this are held for manual review and can't win until approved. */
  holdAt: number;
  /** Scores at or above this are rejected outright. */
  blockAt: number;
  /** Always require an email code before entries count. */
  alwaysVerifyEmail: boolean;
}

export const DEFAULT_RISK_POLICY: RiskPolicy = {
  verifyAt: 20,
  holdAt: 50,
  blockAt: 80,
  alwaysVerifyEmail: true,
};

export function scoreSignals(signals: Signal[]) {
  const unique = new Map(signals.map((s) => [s.code, s]));
  // A busy address is also a busy subnet: count the same crowd once.
  if (unique.has("ip_burst")) unique.delete("subnet_burst");
  const score = Math.min(
    100,
    [...unique.keys()].reduce((sum, code) => sum + SIGNAL_WEIGHTS[code], 0),
  );
  return { score, signals: [...unique.values()] };
}

export function decide(
  score: number,
  policy: RiskPolicy = DEFAULT_RISK_POLICY,
): Decision {
  if (score >= policy.blockAt) return "block";
  if (score >= policy.holdAt) return "hold";
  if (score >= policy.verifyAt || policy.alwaysVerifyEmail) return "verify";
  return "allow";
}

export function parsePolicy(raw: unknown): RiskPolicy {
  if (!raw || typeof raw !== "object") return DEFAULT_RISK_POLICY;
  return { ...DEFAULT_RISK_POLICY, ...(raw as Partial<RiskPolicy>) };
}
