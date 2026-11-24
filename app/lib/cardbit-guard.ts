// Cardbit bot and fraud guard: pure rules, so they can be unit tested and explained to staff.
// The server side (counters, profiles, Turnstile) is in cardbit-guard.server.ts.

/** Customer actions the guard watches. */
export type GuardAction =
  | "spin"
  | "checkin"
  | "avatar"
  | "pack"
  | "buyback"
  | "ship-quote"
  | "ship"
  | "ship-cancel"
  | "spark-shop"
  | "topup"
  | "giveaway";

/**
 * "off": nothing runs. "log": every rule runs and records what it would have done, but nobody is
 * refused (the default, so a deploy changes nothing customers see). "on": rules refuse requests.
 */
export type GuardMode = "off" | "log" | "on";

export function guardMode(env: NodeJS.ProcessEnv = process.env): GuardMode {
  const v = env.CARDBIT_GUARD;
  return v === "on" ? "on" : v === "off" ? "off" : "log";
}

/** Per signed-in customer. Generous for people, tight for scripts. */
export const RATE_LIMITS: Record<GuardAction, { perMinute: number; perHour: number }> = {
  spin: { perMinute: 10, perHour: 120 },
  checkin: { perMinute: 5, perHour: 30 },
  avatar: { perMinute: 10, perHour: 60 },
  pack: { perMinute: 20, perHour: 400 },
  buyback: { perMinute: 30, perHour: 600 },
  "ship-quote": { perMinute: 10, perHour: 60 },
  ship: { perMinute: 5, perHour: 20 },
  "ship-cancel": { perMinute: 5, perHour: 20 },
  "spark-shop": { perMinute: 10, perHour: 120 },
  topup: { perMinute: 5, perHour: 20 },
  giveaway: { perMinute: 10, perHour: 60 },
};

/** Actions that need a passed Turnstile check once CARDBIT_TURNSTILE_SECRET_KEY is set. */
export const DEFAULT_TURNSTILE_ACTIONS: GuardAction[] = ["spin", "checkin", "spark-shop", "giveaway", "topup", "ship"];

export function turnstileActions(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.CARDBIT_TURNSTILE_ACTIONS;
  if (raw === undefined) return new Set(DEFAULT_TURNSTILE_ACTIONS);
  return new Set(raw.split(",").map((a) => a.trim()).filter(Boolean));
}

/** ok: normal. review: staff must look (shipping and buybacks paused). blocked: everything paused.
 *  trusted: staff vouched for the account, so automatic flags no longer pause it. */
export type RiskStatus = "ok" | "review" | "blocked" | "trusted";

export type RiskReason = { code: string; detail?: string; at: string };

/** What each status lets a customer do. Free rewards still need a clean account. */
export function statusAllows(status: RiskStatus, action: GuardAction) {
  if (status === "blocked") return false;
  if (status === "review") return !["ship", "buyback", "topup", "spin", "spark-shop", "giveaway"].includes(action);
  return true;
}

/** How many distinct customers may share one device or one payment card before all are reviewed. */
export const SHARED_LIMIT = { device: 3, card: 2 } as const;

export type HoldConfig = {
  /** Shipping waits this long after the Shopify account was created. */
  newAccountShipHours: number;
  /** Shipping waits this long after each paid top-up. */
  topupShipHours: number;
  /** Paid top-ups allowed in the account's first week (cents, rolling 24h and week total). */
  newAccountDailyCents: number;
  newAccountWeekCents: number;
  /** Paid top-ups allowed per rolling 24h after the first week. */
  dailyCents: number;
};

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : d;
};

export function holdConfig(env: NodeJS.ProcessEnv = process.env): HoldConfig {
  return {
    newAccountShipHours: num(env.CARDBIT_SHIP_HOLD_NEW_ACCOUNT_HOURS, 72),
    topupShipHours: num(env.CARDBIT_SHIP_HOLD_TOPUP_HOURS, 72),
    newAccountDailyCents: num(env.CARDBIT_TOPUP_NEW_DAILY_CENTS, 10_000),
    newAccountWeekCents: num(env.CARDBIT_TOPUP_NEW_WEEK_CENTS, 25_000),
    dailyCents: num(env.CARDBIT_TOPUP_DAILY_CENTS, 100_000),
  };
}

const HOUR = 3_600_000;

/** When shipping opens for this account, or null when it is open now. */
export function shipOpensAt(
  input: { accountCreatedAt: Date | null; lastPaidTopupAt: Date | null; status: RiskStatus },
  now: Date,
  config: HoldConfig,
): Date | null {
  if (input.status === "trusted") return null;
  const times = [
    input.accountCreatedAt && new Date(input.accountCreatedAt.getTime() + config.newAccountShipHours * HOUR),
    input.lastPaidTopupAt && new Date(input.lastPaidTopupAt.getTime() + config.topupShipHours * HOUR),
  ].filter((d): d is Date => !!d && d > now);
  return times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null;
}

/** The most a customer may top up right now (cents). */
export function topupAllowance(
  input: { accountCreatedAt: Date | null; paidLast24hCents: number; paidLastWeekCents: number; status: RiskStatus },
  now: Date,
  config: HoldConfig,
) {
  if (input.status === "blocked" || input.status === "review") return 0;
  if (input.status === "trusted") return Math.max(0, config.dailyCents - input.paidLast24hCents);
  const created = input.accountCreatedAt ?? now;
  const isNew = now.getTime() - created.getTime() < 7 * 24 * HOUR;
  if (!isNew) return Math.max(0, config.dailyCents - input.paidLast24hCents);
  return Math.max(
    0,
    Math.min(config.newAccountDailyCents - input.paidLast24hCents, config.newAccountWeekCents - input.paidLastWeekCents),
  );
}

/**
 * Stripe's 3D Secure setting for a top-up: always ask on a new account, a first top-up, or $100
 * and up (the bank then carries fraud chargebacks); otherwise let Stripe and Radar decide.
 */
export function threeDSecure(input: { accountCreatedAt: Date | null; paidTopups: number; cents: number }, now: Date) {
  const created = input.accountCreatedAt ?? now;
  const isNew = now.getTime() - created.getTime() < 7 * 24 * HOUR;
  return isNew || input.paidTopups === 0 || input.cents >= 10_000 ? "any" : "automatic";
}

export function formatOpens(at: Date) {
  return at.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
