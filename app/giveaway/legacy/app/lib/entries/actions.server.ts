import {sharedTask,claimCampaignSocial} from "../../../../campaign-social.server";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ActionType } from "@prisma/client";
import db from "../../db.server";
import { normalizeEmail } from "../bot/email";
import { hit } from "../bot/rate-limit.server";
import { checkOtp } from "../otp.server";
import { issueEntrantToken, readEntrantToken } from "../token.server";
import { award, entrantTotal } from "./ledger.server";
import {
  answerMatches,
  entriesBreakdown,
  isArchived,
  leaderboardName,
  matchPollOption,
  requiredActions,
  visibleActions,
} from "./actions";
import { activate, enterToday, findLiveCampaign } from "./signup.server";
import { actionDedupeKey, repeatSuffix } from "./repeat";
import { mirrorAction } from "./linked.server";
import { normalizeUsPhone } from "../phone";
import { queueKlaviyoSync } from "../klaviyo.server";
import { parseSettings } from "../settings";
import { latestInstagramPost } from "../instagram.server";
import { buylistSubmittedSince } from "../buylist-verify.server";
import { marketListedSince } from "../market-verify.server";
import {
  dailyUnlocked,
  isDailyTask,
  nextWindow,
  openWindow,
  rotatedUrl,
  taskDay,
  taskStatus,
  type TaskConfig,
} from "../daily-tasks";

type CampaignLike = { settings: unknown; timezone: string };

/** The current task day for a giveaway's Daily Tasks (see app/lib/daily-tasks.ts). */
export function currentTaskDay(campaign: CampaignLike, now = new Date()) {
  const s = parseSettings(campaign.settings);
  return taskDay(
    now,
    s.dailyTasks.resetAt,
    s.daily.enabled
      ? { timeZone: campaign.timezone, drawTime: s.daily.drawTime }
      : null,
  );
}

interface TaskAction {
  id: string;
  type: ActionType;
  mandatory: boolean;
  config: unknown;
}

/**
 * Daily Tasks for the widget: whether they're unlocked, when they reset, and per task whether
 * it's open now, already claimed in this task day (or scheduled window), and today's link.
 */
export function dailyTaskState(
  campaign: CampaignLike & { actions: (TaskAction & { label: string })[] },
  entrantId: string,
  events: { actionId: string | null; dedupeKey: string | null }[],
  now = new Date(),
  // The newest Instagram post, for tasks set to always open it.
  latestInstagram: string | null = null,
) {
  const live = campaign.actions.filter((a) => !isArchived(a));
  const daily = live.filter(isDailyTask);
  if (!daily.length) return null;
  const done = new Set(events.map((e) => e.actionId));
  const keys = new Set(events.map((e) => e.dedupeKey));
  const { unlocked, need } = dailyUnlocked(live, done);
  const day = currentTaskDay(campaign, now);
  return {
    unlocked,
    // The tasks still to do before Daily Tasks unlock.
    needed: need.filter((a) => !done.has(a.id)).map((a) => a.label),
    needCount: need.length,
    resetsAt: day.resetsAt,
    tasks: Object.fromEntries(
      daily.map((a) => {
        const c = (a.config ?? {}) as TaskConfig;
        const st = taskStatus(c, day, true, now);
        const win = c.schedule ? openWindow(c.schedule, now) : null;
        const next = c.schedule && !win ? nextWindow(c.schedule, now) : null;
        return [
          a.id,
          {
            // Scheduled tasks are only open in their window (and not switched off).
            open: st.claimable,
            done:
              st.claimable &&
              keys.has(actionDedupeKey(a.id, entrantId, st.dedupeSuffix)),
            url:
              (c.latestInstagram && latestInstagram) || rotatedUrl(c, day.key),
            closesAt: win?.closesAt ?? null,
            nextAt: c.paused ? null : (next?.opensAt ?? null),
          },
        ];
      }),
    ),
  };
}

export async function verifyEntrant(
  shop: string,
  campaignSlug: string,
  email: string,
  code: string,
) {
  const campaign = await findLiveCampaign(shop, campaignSlug);
  if (!campaign)
    return { ok: false as const, error: "This giveaway isn't open right now." };
  const entrant = await db.entrant.findUnique({
    where: {
      campaignId_emailNormalized: {
        campaignId: campaign.id,
        emailNormalized: normalizeEmail(email),
      },
    },
  });
  if (!entrant || !(await checkOtp(entrant.id, code))) {
    return {
      ok: false as const,
      error: "That code didn't match. Check your email and try again.",
    };
  }
  if (entrant.status === "PENDING_VERIFICATION") await activate(entrant.id);
  // A returning entrant who confirmed their email is entering again: put them in today's draw.
  else await enterToday(entrant.id);
  const fresh = await db.entrant.findUniqueOrThrow({
    where: { id: entrant.id },
  });
  return {
    ok: true as const,
    state: fresh.status === "ACTIVE" ? ("active" as const) : ("held" as const),
    token: issueEntrantToken(fresh.id, campaign.id),
    referralCode: fresh.referralCode,
    entries: await entrantTotal(fresh.id),
  };
}

// Quiz answers allowed per entrant per question in a rolling day (counted in RateLimitHit,
// which is pruned after a day).
export const QUIZ_ATTEMPTS = 3;
const QUIZ_WINDOW_S = 24 * 3600;
const quizKey = (actionId: string, entrantId: string) =>
  `quiz:${actionId}:${entrantId}`;

// Actions the entrant can't complete from the action list, so they never lock the others.

/** Status for the widget: entries and where they came from, completed actions, referral link. */
export async function entrantState(token: string) {
  const t = readEntrantToken(token);
  if (!t) return null;
  const entrant = await db.entrant.findUnique({
    where: { id: t.entrantId },
    include: {
      campaign: { include: { actions: true } },
      events: {
        select: {
          actionId: true,
          dedupeKey: true,
          source: true,
          entries: true,
          orderLogId: true,
        },
      },
      responses: {
        select: {
          actionId: true,
          answer: true,
          action: { select: { type: true } },
        },
      },
    },
  });
  if (!entrant || entrant.campaignId !== t.campaignId) return null;

  const pollIds = entrant.responses
    .filter((r) => r.action.type === "POLL")
    .map((r) => r.actionId);
  const [pollCounts, quizHits] = await Promise.all([
    pollIds.length
      ? db.actionResponse.groupBy({
          by: ["actionId", "answer"],
          where: { actionId: { in: pollIds } },
          _count: { _all: true },
        })
      : [],
    db.rateLimitHit.groupBy({
      by: ["key"],
      where: {
        key: { startsWith: "quiz:", endsWith: `:${entrant.id}` },
        createdAt: { gte: new Date(Date.now() - QUIZ_WINDOW_S * 1000) },
      },
      _count: { _all: true },
    }),
  ]);
  const pollResults: Record<string, Record<string, number>> = {};
  for (const row of pollCounts) {
    (pollResults[row.actionId] ??= {})[row.answer] = row._count._all;
  }
  const quizAttemptsLeft: Record<string, number> = {};
  for (const row of quizHits) {
    const actionId = row.key.split(":")[1];
    quizAttemptsLeft[actionId] = Math.max(0, QUIZ_ATTEMPTS - row._count._all);
  }

  return {
    state:
      entrant.status === "ACTIVE"
        ? "active"
        : entrant.status === "HELD"
          ? "held"
          : "verify",
    referralCode: entrant.referralCode,
    entries: await entrantTotal(entrant.id),
    breakdown: entriesBreakdown(entrant.events),
    completedActionIds: [
      ...new Set(entrant.events.map((e) => e.actionId).filter(Boolean)),
    ],
    // The entrant's own poll and quiz answers, keyed by action id.
    answers: Object.fromEntries(
      entrant.responses
        .filter((r) => r.action.type !== "ALTERNATE_ENTRY")
        .map((r) => [r.actionId, r.answer]),
    ),
    pollResults,
    quizAttemptsLeft,
    // Null when the giveaway has no Daily Tasks.
    dailyTasks: dailyTaskState(
      entrant.campaign,
      entrant.id,
      entrant.events,
      new Date(),
      entrant.campaign.actions.some(
        (a) => isDailyTask(a) && (a.config as TaskConfig).latestInstagram,
      )
        ? await latestInstagramPost()
        : null,
    ),
  };
}

/** Top entrants by entries, shown as first name and last initial only. */
export async function leaderboard(
  campaignId: string,
  token?: string | null,
  limit = 10,
) {
  return markYou(await leaderboardRows(campaignId, limit), token);
}

/** The top entrants, the same for every shopper (cacheable); `markYou` adds the "you" flag. */
export async function leaderboardRows(campaignId: string, limit = 10) {
  const rows = await db.entryEvent.groupBy({
    by: ["entrantId"],
    where: { campaignId, entrant: { status: "ACTIVE" } },
    _sum: { entries: true },
    orderBy: { _sum: { entries: "desc" } },
    take: limit,
  });
  const people = await db.entrant.findMany({
    where: { id: { in: rows.map((r) => r.entrantId) } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(people.map((p) => [p.id, p]));
  return rows
    .filter((r) => (r._sum.entries ?? 0) > 0 && byId.has(r.entrantId))
    .map((r, i) => {
      const p = byId.get(r.entrantId)!;
      return {
        entrantId: r.entrantId,
        rank: i + 1,
        name: leaderboardName(p.name, p.email),
        entries: r._sum.entries ?? 0,
      };
    });
}

export function markYou(
  rows: Awaited<ReturnType<typeof leaderboardRows>>,
  token?: string | null,
) {
  const me = readEntrantToken(token)?.entrantId;
  return rows.map(({ entrantId, ...r }) => ({ ...r, you: entrantId === me }));
}

// WATCH_VIDEO: "start" hands back a signed start time, and completing checks that enough
// time has passed since then. Stateless, so nothing is stored until the entry is earned.
const VIDEO_GRACE_MS = 1000;
const VIDEO_MAX_AGE_MS = 6 * 3600 * 1000;
// Seconds between opening a "tap after you do it" daily task's link and claiming it.
export const CONFIRM_WAIT_S = 5;

function videoKey() {
  const s = process.env.CARDBIT_GIVEAWAY_ENTRANT_TOKEN_SECRET ?? process.env.SHOPIFY_API_SECRET;
  if (!s)
    throw new Error("ENTRANT_TOKEN_SECRET (or SHOPIFY_API_SECRET) must be set");
  return s;
}

const videoSig = (entrantId: string, actionId: string, startedAt: number) =>
  createHmac("sha256", videoKey())
    .update(`video.${entrantId}.${actionId}.${startedAt}`)
    .digest("base64url");

export function issueVideoStart(
  entrantId: string,
  actionId: string,
  now = Date.now(),
) {
  return `${now}.${videoSig(entrantId, actionId, now)}`;
}

/** Milliseconds since a valid start token was issued, or null if it's forged or stale. */
export function videoElapsed(
  started: string | undefined,
  entrantId: string,
  actionId: string,
  now = Date.now(),
) {
  const [ts, sig] = (started ?? "").split(".");
  const startedAt = Number(ts);
  if (!ts || !Number.isFinite(startedAt) || !sig) return null;
  const expected = Buffer.from(videoSig(entrantId, actionId, startedAt));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  const elapsed = now - startedAt;
  return elapsed < 0 || elapsed > VIDEO_MAX_AGE_MS ? null : elapsed;
}

export interface ActionPayload {
  code?: string;
  /** POLL option, QUESTION answer, or ALTERNATE_ENTRY mailing address. */
  answer?: string;
  /** WATCH_VIDEO: "start" when the video is opened; anything else completes it. */
  step?: string;
  /** WATCH_VIDEO: the token the "start" step returned. */
  started?: string;
  /** SOCIAL_SHARE: x, facebook, whatsapp or copy. */
  network?: string;
  /** SMS_OPTIN: the mobile number, and whether the consent box was checked. */
  phone?: string;
  consent?: boolean;
}

const fail = (error: string, attemptsLeft?: number) => ({
  ok: false as const,
  error,
  ...(attemptsLeft === undefined ? {} : { attemptsLeft }),
});

const saveResponse = (actionId: string, entrantId: string, answer: string) =>
  db.actionResponse.upsert({
    where: { actionId_entrantId: { actionId, entrantId } },
    create: { actionId, entrantId, answer },
    update: { answer },
  });

export async function completeAction(
  token: string,
  actionId: string,
  payload: ActionPayload,
) {
  const t = readEntrantToken(token);
  if (!t) return fail("Please sign up first.");
  const [entrant, action] = await Promise.all([
    db.entrant.findUnique({
      where: { id: t.entrantId },
      include: { events: { select: { actionId: true } } },
    }),
    db.entryAction.findUnique({
      where: { id: actionId },
      include: { campaign: { include: { actions: true } } },
    }),
  ]);
  if (
    !entrant ||
    !action ||
    action.campaignId !== t.campaignId ||
    isArchived(action)
  ) {
    return fail("Unknown action.");
  }
  if (entrant.status !== "ACTIVE") return fail("Verify your email first.");
  if (["SIGNUP", "REFERRAL"].includes(action.type)) {
    return fail("That one is awarded automatically.");
  }

  // Mandatory actions come first: the rest unlock once they're all done.
  const done = new Set(entrant.events.map((e) => e.actionId));
  if (!action.mandatory && action.type !== "ALTERNATE_ENTRY") {
    const missing = requiredActions(
      visibleActions(action.campaign.actions),
    ).filter((a) => !done.has(a.id));
    if (missing.length)
      return fail(`Complete "${missing[0].label}" first to unlock the rest.`);
  }

  const config = (action.config ?? {}) as Record<string, unknown>;

  // Daily Tasks: unlocked by the follow tasks, once per task day (or scheduled window).
  let dailySuffix: string | null = null;
  if (isDailyTask(action)) {
    const { unlocked } = dailyUnlocked(
      action.campaign.actions.filter((a) => !isArchived(a)),
      done,
    );
    const day = currentTaskDay(action.campaign);
    const st = taskStatus(config as TaskConfig, day, unlocked, new Date());
    if (!st.claimable) return fail(st.reason);
    dailySuffix = st.dedupeSuffix;
    // "Submit A Buylist": only a real submission from this email since the task day began counts.
    if (config.verifyBuylist === true) {
      if (payload.step === "start")
        return { ok: true as const, started: "verify", seconds: 0 };
      const found = await buylistSubmittedSince(entrant.email, day.startsAt);
      if (found === null)
        return fail(
          "We couldn't check the buylist right now. Try again in a minute.",
        );
      if (!found)
        return fail(
          `We don't see an approved buylist from ${entrant.email} yet today. Buylists count once we approve them (usually within 24 hours). Tap again after you get the approval email.`,
        );
    }
    // "List A Card On Vault Marketplace": only a real Vault Market listing since the task day began.
    if (config.verifyMarketListing === true) {
      if (payload.step === "start")
        return { ok: true as const, started: "verify", seconds: 0 };
      const found = await marketListedSince(
        action.campaign.shop,
        entrant.email,
        day.startsAt,
        entrant.shopifyCustomerId,
      );
      if (found === null)
        return fail(
          "We couldn't check Vault Market right now. Try again in a minute.",
        );
      if (!found)
        return fail(
          `We don't see a Vault Market listing from ${entrant.email} yet today. List a card from your vault while signed in with this email, then tap again.`,
        );
    }
    // "Tap after you do it" tasks: the link has to be opened (step "start") a few seconds
    // before the claim. It's a self-confirmation, not proof the person liked or commented.
    if (
      typeof config.confirm === "string" &&
      config.confirm &&
      config.verifyBuylist !== true &&
      config.verifyMarketListing !== true &&
      action.type !== "WATCH_VIDEO"
    ) {
      if (payload.step === "start")
        return {
          ok: true as const,
          started: issueVideoStart(entrant.id, action.id),
          seconds: CONFIRM_WAIT_S,
        };
      const elapsed = videoElapsed(payload.started, entrant.id, action.id);
      if (elapsed === null) return fail("Open the link first.");
      if (elapsed + VIDEO_GRACE_MS < CONFIRM_WAIT_S * 1000)
        return fail("Give it a few seconds, then tap again.");
    }
  }

  const answer = payload.answer?.trim() ?? "";
  let repeatable = action.type === "DAILY_CHECKIN" || action.repeatable;
  let smsOptIn = false;

  switch (action.type) {
    case "SECRET_CODE": {
      const expected = String(config.code ?? "")
        .trim()
        .toLowerCase();
      if (!expected || payload.code?.trim().toLowerCase() !== expected) {
        return fail("That's not the right code.");
      }
      break;
    }
    case "POLL": {
      const options = Array.isArray(config.options)
        ? config.options.filter((o): o is string => typeof o === "string")
        : [];
      const option = matchPollOption(options, answer);
      if (!option) return fail("Please pick one of the options.");
      // The first vote stands; voting again doesn't change the tally.
      await db.actionResponse.upsert({
        where: {
          actionId_entrantId: { actionId: action.id, entrantId: entrant.id },
        },
        create: { actionId: action.id, entrantId: entrant.id, answer: option },
        update: {},
      });
      repeatable = false;
      break;
    }
    case "QUESTION": {
      if (!answer) return fail("Please type an answer.");
      if (answer.length > 500) return fail("That answer is too long.");
      const expected = typeof config.answer === "string" ? config.answer : "";
      repeatable = false;
      if (done.has(action.id)) break; // already earned; award() below is a no-op
      if (expected) {
        const used = await hit(quizKey(action.id, entrant.id), QUIZ_WINDOW_S);
        if (used > QUIZ_ATTEMPTS)
          return fail("No tries left today. Come back tomorrow.", 0);
        await saveResponse(action.id, entrant.id, answer);
        if (!answerMatches(answer, expected)) {
          const left = QUIZ_ATTEMPTS - used;
          return fail(
            left > 0
              ? `Not quite. ${left} ${left === 1 ? "try" : "tries"} left.`
              : "Not quite, and that was your last try for today.",
            left,
          );
        }
      } else {
        await saveResponse(action.id, entrant.id, answer);
      }
      break;
    }
    case "WATCH_VIDEO": {
      const seconds = typeof config.seconds === "number" ? config.seconds : 0;
      if (payload.step === "start") {
        return {
          ok: true as const,
          started: issueVideoStart(entrant.id, action.id),
          seconds,
        };
      }
      const elapsed = videoElapsed(payload.started, entrant.id, action.id);
      if (elapsed === null) return fail("Open the video first.");
      if (elapsed + VIDEO_GRACE_MS < seconds * 1000) {
        const left = Math.ceil((seconds * 1000 - elapsed) / 1000);
        return fail(`Keep watching: ${left}s to go.`);
      }
      break;
    }
    case "SOCIAL_SHARE": {
      const network = String(config.network ?? "any");
      if (network !== "any" && payload.network !== network) {
        return fail(
          `Share on ${network === "x" ? "X" : "Facebook"} to earn this one.`,
        );
      }
      repeatable = false;
      break;
    }
    case "ALTERNATE_ENTRY": {
      // No purchase necessary: the mailing address is kept with the entry for the record.
      if (answer.length < 5) return fail("Please enter your mailing address.");
      await saveResponse(action.id, entrant.id, answer.slice(0, 500));
      repeatable = false;
      break;
    }
    case "SMS_OPTIN": {
      // Entries only with the box checked, so nobody is texted without agreeing.
      const phone = normalizeUsPhone(payload.phone ?? "");
      if (!phone) return fail("Enter a valid US mobile number.");
      if (payload.consent !== true)
        return fail("Check the box to agree to text messages.");
      repeatable = false;
      if (done.has(action.id)) break;
      const taken = await db.entrant.findFirst({
        where: {
          campaignId: action.campaignId,
          phone,
          id: { not: entrant.id },
        },
        select: { id: true },
      });
      if (taken) return fail("That number is already entered.");
      await db.entrant.update({
        where: { id: entrant.id },
        data: { phone, smsConsentAt: new Date() },
      });
      smsOptIn = true;
      break;
    }
    default:
      // VISIT_URL, SOCIAL_FOLLOW, DAILY_CHECKIN and CUSTOM count on click.
      break;
  }

  // Daily-draw giveaways repeat on the draw's schedule (e.g. 9pm to 9pm), not the UTC date.
  const canonical=sharedTask(action);
  const awarded = canonical ? await claimCampaignSocial(action,entrant,canonical) : await award({
    campaignId: action.campaignId,
    entrantId: entrant.id,
    entries: action.entries,
    source: "ACTION",
    actionId: action.id,
    dedupeKey: actionDedupeKey(
      action.id,
      entrant.id,
      dailySuffix ?? repeatSuffix(action.campaign, repeatable),
    ),
  });
  // Texts, follows and check-ins also count in the linked giveaway, if there is one.
  if (awarded && !canonical) await mirrorAction(entrant.id, action.id);
  if (smsOptIn) queueKlaviyoSync(entrant.id);
  return {
    ok: true as const,
    awarded,
    entries: await entrantTotal(entrant.id),
  };
}
