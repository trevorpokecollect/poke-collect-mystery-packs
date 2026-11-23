import { rulesFromForm, type CampaignFormValues } from "./campaign-form";
import { periodFor } from "./daily";
import { parseLocalDateTime } from "./time";
import { estimateEntries } from "./entries/estimate";
import { purchaseRateText } from "./shop-promo";
import { isArchived, publicAction, visibleActions } from "./entries/actions";
import { isDailyTask, rotatedUrl, taskDay, unlockTasks } from "./daily-tasks";

// What the storefront widget would get from /apps/packs/campaigns/<slug>, built from the editor's
// unsaved values, so the admin preview renders the real widget without a live giveaway.

export interface PreviewPrize {
  title: string;
  imageUrl: string | null;
}

export function previewData(
  v: CampaignFormValues,
  opts: {
    imageUrl: string | null;
    entered: boolean;
    dailyPrize?: PreviewPrize | null;
    upcoming?: { date: string; title: string; imageUrl: string | null }[];
    now?: Date;
  },
) {
  const actions = visibleActions(
    v.actions
      .filter((a) => !isArchived(a))
      .map((a) => ({ ...a, id: a.id ?? a.key })),
  ).map(publicAction);
  const signup = v.actions.find((a) => a.type === "SIGNUP")?.entries ?? 1;
  const daily = v.settings.daily;
  const now = opts.now ?? new Date();
  return {
    shop: shopPreview(v),
    linkedToken: null,
    linked: null,
    campaign: {
      title: v.title || "Untitled giveaway",
      description: v.description,
      prize: v.prize,
      imageUrl: opts.imageUrl,
      endsAt: v.endsAt
        ? (parseLocalDateTime(v.endsAt, v.timezone)?.toISOString() ?? null)
        : null,
      rulesText: v.rulesText,
      requireEmailConsent: v.settings.requireEmailConsent,
      requireName: v.settings.requireName,
      imageBackdrop: v.settings.imageBackdrop,
      actions,
    },
    turnstileSiteKey: null,
    entrant: opts.entered
      ? {
          state: "active",
          referralCode: "preview",
          entries: signup,
          breakdown: {
            signup,
            actions: 0,
            purchases: 0,
            referrals: 0,
            other: 0,
          },
          completedActionIds: [],
          answers: {},
          pollResults: {},
          quizAttemptsLeft: {},
          dailyTasks: previewDailyTasks(v, now),
        }
      : null,
    daily: daily.enabled
      ? {
          drawAt: periodFor(
            now,
            v.timezone,
            daily.drawTime,
          ).drawAt.toISOString(),
          prize: opts.dailyPrize
            ? { ...opts.dailyPrize, value: 0, url: null }
            : null,
          yourEntries: opts.entered ? signup : null,
          enteredToday: opts.entered ? true : null,
          lastWinner: null,
          upcoming: opts.upcoming ?? [],
          tomorrow: opts.upcoming?.[0]?.date ?? null,
        }
      : null,
    leaderboard: null,
  };
}

/** The "Shop & earn" box from unsaved values, with prices from when each product was picked. */
function shopPreview(v: CampaignFormValues) {
  const cfg = v.settings.shop;
  if (!cfg.enabled) return null;
  const rules = rulesFromForm(v.rules, v.timezone);
  if (!rules.ok) return null;
  const rate = purchaseRateText(rules.value);
  if (!rate) return null;
  return {
    rate,
    url: cfg.url || "/collections/all",
    items: cfg.products.map((p) => ({
      title: p.title,
      url: "#",
      imageUrl: p.imageUrl,
      price: p.price,
      entries: estimateEntries(rules.value, [
        { productId: p.id, quantity: 1, price: Math.round(p.price * 100) },
      ]),
    })),
  };
}

/** Daily Tasks as a new entrant sees them (still locked); scheduled ones shown as open. */
function previewDailyTasks(v: CampaignFormValues, now: Date) {
  const live = v.actions
    .filter((a) => !isArchived(a))
    .map((a) => ({ ...a, id: a.id ?? a.key }));
  const daily = live.filter(isDailyTask);
  if (!daily.length) return null;
  const need = unlockTasks(live);
  const day = taskDay(
    now,
    v.settings.dailyTasks.resetAt,
    v.settings.daily.enabled
      ? { timeZone: v.timezone, drawTime: v.settings.daily.drawTime }
      : null,
  );
  return {
    unlocked: need.length === 0,
    needed: need.map((a) => a.label),
    needCount: need.length,
    resetsAt: day.resetsAt.toISOString(),
    tasks: Object.fromEntries(
      daily.map((a) => [
        a.id,
        {
          open: !a.config.paused,
          done: false,
          url: rotatedUrl(a.config, day.key),
          closesAt: null,
          nextAt: null,
        },
      ]),
    ),
  };
}
