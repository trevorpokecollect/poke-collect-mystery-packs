import type { ActionType } from "@prisma/client";
import { z } from "zod";
import { purchaseRulesSchema, type PurchaseRules } from "./entries/rules";
import {
  actionConfigSchema,
  campaignSettingsSchema,
  type CampaignSettings,
} from "./settings";
import { slugify } from "./slug";
import { parseLocalDateTime, toLocalInput } from "./time";

// Shape of the admin giveaway editor (New and Edit). Pure, so the browser can
// run the same conversions for the live purchase preview and the rules
// generator. Dates are datetime-local strings in the campaign timezone.

export const DEFAULT_TIMEZONE = "America/New_York";
export const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const SPONSOR = "Cardbit";

interface ActionMeta {
  name: string;
  defaultLabel: string;
  defaultEntries: number;
  // Can award once per day instead of once per giveaway.
  repeatable: boolean;
  // At most one per giveaway.
  single?: boolean;
  help: string;
}

export const ACTION_META: Record<ActionType, ActionMeta> = {
  SIGNUP: {
    name: "Sign up",
    defaultLabel: "Enter the giveaway",
    defaultEntries: 1,
    repeatable: false,
    single: true,
    help: "Awarded once the entrant verifies their email. Always required.",
  },
  REFERRAL: {
    name: "Refer a friend",
    defaultLabel: "Refer a friend",
    defaultEntries: 5,
    repeatable: false,
    single: true,
    help: "Entries per friend who signs up and verifies with the entrant's link.",
  },
  DAILY_CHECKIN: {
    name: "Daily check-in",
    defaultLabel: "Daily check-in",
    defaultEntries: 1,
    repeatable: false,
    single: true,
    help: "Can be claimed once per day.",
  },
  SOCIAL_FOLLOW: {
    name: "Follow on social",
    defaultLabel: "Follow us on Instagram",
    defaultEntries: 2,
    repeatable: false,
    help: "Opens your profile; entries are awarded on click.",
  },
  VISIT_URL: {
    name: "Visit a page",
    defaultLabel: "Check out the new set",
    defaultEntries: 1,
    repeatable: true,
    help: "Opens a page on or off your store.",
  },
  WATCH_VIDEO: {
    name: "Watch a video",
    defaultLabel: "Watch our latest opening",
    defaultEntries: 2,
    repeatable: true,
    help: "The entrant must keep the video open for the set number of seconds.",
  },
  SOCIAL_SHARE: {
    name: "Share the giveaway",
    defaultLabel: "Share the giveaway",
    defaultEntries: 2,
    repeatable: true,
    help: "Opens a share dialog with the giveaway link.",
  },
  SECRET_CODE: {
    name: "Secret code",
    defaultLabel: "Enter the secret code",
    defaultEntries: 5,
    repeatable: true,
    help: "Share the code on a live show or in an email. Not case-sensitive.",
  },
  POLL: {
    name: "Poll",
    defaultLabel: "Which set should we open next?",
    defaultEntries: 1,
    repeatable: false,
    help: "Any answer earns the entries. Answers show in the admin.",
  },
  QUESTION: {
    name: "Question or quiz",
    defaultLabel: "Answer a question",
    defaultEntries: 1,
    repeatable: false,
    help: "Leave the answer blank for a free-text question; set one to make it a quiz.",
  },
  ALTERNATE_ENTRY: {
    name: "Alternate free entry",
    defaultLabel: "No purchase necessary: free entry",
    defaultEntries: 1,
    repeatable: false,
    single: true,
    help: "Only needed for a mail-in method: the instructions are quoted in the official rules. Signing up is already free, so the storefront doesn't show this as a button.",
  },
  SMS_OPTIN: {
    name: "Text (SMS) sign-up",
    defaultLabel: "Get text alerts for drops",
    defaultEntries: 5,
    repeatable: false,
    single: true,
    help: "Asks for a US mobile number and an unchecked consent box. Entries are awarded only when they agree, and the number is sent to Klaviyo as an SMS subscriber.",
  },
  CUSTOM: {
    name: "Custom",
    defaultLabel: "Custom action",
    defaultEntries: 1,
    repeatable: false,
    help: "",
  },
};

/** Types the merchant can add from the editor (SIGNUP is always present). */
export const ADDABLE_ACTION_TYPES: ActionType[] = [
  "REFERRAL",
  "DAILY_CHECKIN",
  "SOCIAL_FOLLOW",
  "VISIT_URL",
  "WATCH_VIDEO",
  "SOCIAL_SHARE",
  "SECRET_CODE",
  "POLL",
  "QUESTION",
  "SMS_OPTIN",
  "ALTERNATE_ENTRY",
];

export interface ActionConfigForm {
  url?: string;
  seconds?: number;
  network?: "x" | "facebook" | "any";
  code?: string;
  question?: string;
  options?: string[];
  answer?: string;
  instructions?: string;
  disclosure?: string;
  // Daily Tasks (see app/lib/daily-tasks.ts).
  daily?: boolean;
  urls?: string[];
  confirm?: string;
  schedule?: { days: number[]; start: string; end: string };
  live?: boolean;
  paused?: boolean;
  latestInstagram?: boolean;
  verifyBuylist?: boolean;
  verifyMarketListing?: boolean;
}

/** Types that can be a Daily Task. */
export const DAILY_TASK_TYPES: ActionType[] = [
  "VISIT_URL",
  "DAILY_CHECKIN",
  "WATCH_VIDEO",
  "SECRET_CODE",
];

export interface ActionForm {
  key: string;
  // Existing EntryAction id when editing.
  id?: string;
  type: ActionType;
  label: string;
  entries: number;
  mandatory: boolean;
  repeatable: boolean;
  config: ActionConfigForm;
  // Has ledger history, so removing it archives instead of deleting.
  hasEvents?: boolean;
}

export interface TargetForm {
  productIds: string[];
  variantIds: string[];
}

export interface LocalRange {
  start: string;
  end: string;
}

export interface ProductRuleForm extends TargetForm {
  key: string;
  name: string;
  mode: "per_unit" | "per_amount";
  entries: number;
  amount: number;
  dateRange: LocalRange;
  // 0 = no bonus.
  bonusThreshold: number;
  bonusEntries: number;
  skipIfBundleMatched: boolean;
}

export interface BundleForm {
  key: string;
  name: string;
  entries: number;
  groups: (TargetForm & { key: string; quantity: number })[];
  excludeFromOrderTotal: boolean;
}

export interface BoosterForm extends TargetForm {
  key: string;
  name: string;
  multiplier: number;
  excludeFromOrderTotal: boolean;
}

export interface PeriodForm extends LocalRange {
  key: string;
  multiplier: number;
}

export interface RulesForm {
  enabled: boolean;
  autoSignupFromOrders: boolean;
  orderSource: PurchaseRules["orderSource"];
  minOrderValue: number;
  dateRange: LocalRange;
  base: {
    mode: "none" | "fixed" | "per_amount";
    entries: number;
    amount: number;
    basis: "subtotal" | "total";
  };
  productRules: ProductRuleForm[];
  bundles: BundleForm[];
  aovBoosters: BoosterForm[];
  periodMultipliers: PeriodForm[];
}

/** Display info for product/variant GIDs used in the rules. */
export type ResourceLabels = Record<
  string,
  { title: string; productId?: string }
>;

export interface CampaignFormValues {
  title: string;
  prize: string;
  description: string;
  slug: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  imageUrl: string | null;
  removeImage: boolean;
  rulesText: string;
  actions: ActionForm[];
  rules: RulesForm;
  settings: CampaignSettings;
  resources: ResourceLabels;
}

let keySeq = 0;
export const newKey = () =>
  `k${Date.now().toString(36)}${(keySeq++).toString(36)}`;

export function newAction(type: ActionType): ActionForm {
  const meta = ACTION_META[type];
  const config: ActionConfigForm =
    type === "POLL"
      ? { question: "", options: ["", ""] }
      : type === "SOCIAL_SHARE"
        ? { network: "any" }
        : {};
  return {
    key: newKey(),
    type,
    label: meta.defaultLabel,
    entries: meta.defaultEntries,
    mandatory: type === "SIGNUP",
    repeatable: type === "DAILY_CHECKIN",
    config,
  };
}

export const emptyTarget = (): TargetForm => ({
  productIds: [],
  variantIds: [],
});

export function rulesToForm(
  rules: PurchaseRules | null,
  timeZone: string,
): RulesForm {
  const r = rules ?? purchaseRulesSchema.parse({});
  const local = (d?: Date) => toLocalInput(d, timeZone);
  const range = (x?: { start?: Date; end?: Date }) => ({
    start: local(x?.start),
    end: local(x?.end),
  });
  const base = r.base;
  return {
    enabled: rules ? r.enabled : false,
    autoSignupFromOrders: r.autoSignupFromOrders,
    orderSource: r.orderSource,
    minOrderValue: r.minOrderValue,
    dateRange: range(r.dateRange),
    base: {
      mode: base.mode,
      entries: base.mode === "none" ? 1 : base.entries,
      amount: base.mode === "per_amount" ? base.amount : 1,
      basis: base.mode === "per_amount" ? base.basis : "subtotal",
    },
    productRules: r.productRules.map((p) => ({
      key: newKey(),
      name: p.name,
      productIds: p.productIds,
      variantIds: p.variantIds,
      mode: p.mode,
      entries: p.entries,
      amount: p.amount,
      dateRange: range(p.dateRange),
      bonusThreshold: p.bonusThreshold ?? 0,
      bonusEntries: p.bonusEntries ?? 0,
      skipIfBundleMatched: p.skipIfBundleMatched,
    })),
    bundles: r.bundles.map((b) => ({
      key: newKey(),
      name: b.name,
      entries: b.entries,
      excludeFromOrderTotal: b.excludeFromOrderTotal,
      groups: b.groups.map((g) => ({
        key: newKey(),
        productIds: g.productIds,
        variantIds: g.variantIds,
        quantity: g.quantity,
      })),
    })),
    aovBoosters: r.aovBoosters.map((b) => ({
      key: newKey(),
      name: b.name,
      productIds: b.productIds,
      variantIds: b.variantIds,
      multiplier: b.multiplier,
      excludeFromOrderTotal: b.excludeFromOrderTotal,
    })),
    periodMultipliers: r.periodMultipliers.map((p) => ({
      key: newKey(),
      start: local(p.start),
      end: local(p.end),
      multiplier: p.multiplier,
    })),
  };
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const issue = (err: z.ZodError) => {
  const i = err.issues[0];
  return i ? i.message : "Invalid value.";
};

/** Converts the editor state to stored PurchaseRules (dates in `timeZone`). */
export function rulesFromForm(
  form: RulesForm,
  timeZone: string,
): Result<PurchaseRules> {
  let badDate = "";
  let badTarget = "";
  const date = (v: string, what: string) => {
    const d = parseLocalDateTime(v, timeZone);
    if (d === null) badDate ||= what;
    return d ?? undefined;
  };
  const range = (r: LocalRange, what: string) => {
    const start = date(r.start, what);
    const end = date(r.end, what);
    if (start && end && end <= start) badDate ||= what;
    return start || end ? { start, end } : undefined;
  };
  const targets = (t: TargetForm, what: string) => {
    if (!t.productIds.length && !t.variantIds.length) {
      badTarget ||= what;
    }
    return { productIds: t.productIds, variantIds: t.variantIds };
  };

  const base =
    form.base.mode === "none"
      ? { mode: "none" as const }
      : form.base.mode === "fixed"
        ? { mode: "fixed" as const, entries: form.base.entries }
        : {
            mode: "per_amount" as const,
            entries: form.base.entries,
            amount: form.base.amount,
            basis: form.base.basis,
          };

  const raw = {
    enabled: form.enabled,
    autoSignupFromOrders: form.autoSignupFromOrders,
    orderSource: form.orderSource,
    minOrderValue: form.minOrderValue,
    dateRange: range(form.dateRange, "Purchase entry dates"),
    base,
    productRules: form.productRules.map((p, i) => {
      const name = p.name.trim() || `Product rule ${i + 1}`;
      return {
        ...targets(p, name),
        name,
        mode: p.mode,
        entries: p.entries,
        amount: p.amount,
        dateRange: range(p.dateRange, `${name} dates`),
        bonusThreshold: p.bonusThreshold > 0 ? p.bonusThreshold : undefined,
        bonusEntries: p.bonusEntries > 0 ? p.bonusEntries : undefined,
        skipIfBundleMatched: p.skipIfBundleMatched,
      };
    }),
    bundles: form.bundles.map((b, i) => {
      const name = b.name.trim() || `Bundle ${i + 1}`;
      return {
        name,
        entries: b.entries,
        excludeFromOrderTotal: b.excludeFromOrderTotal,
        groups: b.groups.map((g) => ({
          ...targets(g, name),
          quantity: g.quantity,
        })),
      };
    }),
    aovBoosters: form.aovBoosters.map((b, i) => {
      const name = b.name.trim() || `Booster ${i + 1}`;
      return {
        ...targets(b, name),
        name,
        multiplier: b.multiplier,
        excludeFromOrderTotal: b.excludeFromOrderTotal,
      };
    }),
    periodMultipliers: form.periodMultipliers.map((p) => {
      const start = date(p.start, "Bonus period dates");
      const end = date(p.end, "Bonus period dates");
      if (!start || !end || end <= start) badDate ||= "Bonus period dates";
      return { start, end, multiplier: p.multiplier };
    }),
  };
  if (badTarget) {
    return { ok: false, error: `${badTarget}: pick at least one product.` };
  }
  if (badDate) {
    return {
      ok: false,
      error: `${badDate}: pick both dates with the date pickers, end after start.`,
    };
  }
  const parsed = purchaseRulesSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    const where = i?.path.join(" ") ?? "";
    return {
      ok: false,
      error: `Purchase rules (${where}): ${issue(parsed.error)}`,
    };
  }
  return { ok: true, value: parsed.data };
}

export interface ActionData {
  id?: string;
  type: ActionType;
  label: string;
  entries: number;
  mandatory: boolean;
  repeatable: boolean;
  config: Record<string, unknown> | null;
}

export function validateActions(actions: ActionForm[]): Result<ActionData[]> {
  const signups = actions.filter((a) => a.type === "SIGNUP");
  if (signups.length !== 1) {
    return { ok: false, error: "A giveaway needs exactly one sign-up action." };
  }
  const out: ActionData[] = [];
  for (const a of actions) {
    const meta = ACTION_META[a.type];
    const label = a.label.trim();
    const name = `${meta.name}${label ? ` ("${label}")` : ""}`;
    if (!label) return { ok: false, error: `${meta.name}: add a label.` };
    if (!Number.isInteger(a.entries) || a.entries < 0) {
      return { ok: false, error: `${name}: entries must be a whole number.` };
    }
    if (meta.single && actions.filter((x) => x.type === a.type).length > 1) {
      return { ok: false, error: `Only one ${meta.name} action is allowed.` };
    }
    let config: Record<string, unknown> | null = null;
    const schema =
      actionConfigSchema[a.type as keyof typeof actionConfigSchema];
    if (schema) {
      const c = a.config;
      const raw: Record<string, unknown> = {
        ...c,
        url: c.url?.trim() || undefined,
        code: c.code?.trim() || undefined,
        question: c.question?.trim() || undefined,
        answer: c.answer?.trim() || undefined,
        instructions: c.instructions?.trim() || undefined,
        disclosure: c.disclosure?.trim() || undefined,
        options: c.options?.map((o) => o.trim()).filter(Boolean),
        seconds: c.seconds || undefined,
      };
      // Daily Task fields only on daily tasks; schedule/live/paused only with a schedule.
      const daily = DAILY_TASK_TYPES.includes(a.type) && c.daily === true;
      raw.daily = daily || undefined;
      raw.urls = daily
        ? c.urls?.map((u) => u.trim()).filter(Boolean) || undefined
        : undefined;
      raw.confirm = (daily && c.confirm?.trim()) || undefined;
      raw.schedule = daily ? c.schedule : undefined;
      raw.live = (daily && !!raw.schedule && c.live) || undefined;
      raw.paused = (daily && !!raw.schedule && c.paused) || undefined;
      raw.latestInstagram =
        (daily && a.type === "VISIT_URL" && c.latestInstagram) || undefined;
      raw.verifyBuylist =
        (daily && a.type === "VISIT_URL" && c.verifyBuylist) || undefined;
      raw.verifyMarketListing =
        (daily && a.type === "VISIT_URL" && c.verifyMarketListing) || undefined;
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        const field = String(parsed.error.issues[0]?.path[0] ?? "");
        return {
          ok: false,
          error: `${name}: ${configHint(field) ?? issue(parsed.error)}`,
        };
      }
      config = parsed.data as Record<string, unknown>;
    }
    out.push({
      id: a.id,
      type: a.type,
      label,
      entries: a.entries,
      mandatory: a.type === "SIGNUP" ? true : a.mandatory,
      repeatable:
        a.type === "DAILY_CHECKIN" || config?.daily === true
          ? true
          : meta.repeatable && a.repeatable,
      config,
    });
  }
  return { ok: true, value: out };
}

function configHint(field: string) {
  return {
    url: "enter a full link starting with https://",
    code: "enter the secret code.",
    question: "enter the question.",
    options: "add between 2 and 10 answer options.",
    seconds: "seconds must be a whole number.",
    urls: "enter full links starting with https://, one per line.",
    schedule: "pick at least one day and an end time after the start time.",
  }[field];
}

export interface CampaignData {
  title: string;
  slug: string;
  prize: string | null;
  description: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  timezone: string;
  rulesText: string | null;
  purchaseRules: PurchaseRules;
  settings: CampaignSettings;
  actions: ActionData[];
  removeImage: boolean;
}

export function validateCampaignForm(
  values: CampaignFormValues,
): Result<CampaignData> {
  const title = values.title.trim();
  if (!title) return { ok: false, error: "Give the giveaway a title." };
  const slug = slugify(values.slug.trim() || title);
  if (!slug)
    return { ok: false, error: "Use letters or numbers in the link name." };
  const timezone = values.timezone || DEFAULT_TIMEZONE;

  const startsAt = parseLocalDateTime(values.startsAt, timezone);
  const endsAt = parseLocalDateTime(values.endsAt, timezone);
  if (startsAt === null || endsAt === null) {
    return {
      ok: false,
      error: "Pick the start and end dates with the date pickers.",
    };
  }
  if (startsAt && endsAt && endsAt <= startsAt) {
    return { ok: false, error: "The end date must be after the start date." };
  }

  const actions = validateActions(values.actions);
  if (!actions.ok) return actions;
  const rules = rulesFromForm(values.rules, timezone);
  if (!rules.ok) return rules;
  const settings = campaignSettingsSchema.safeParse(values.settings);
  if (!settings.success) {
    const field = settings.error.issues[0]?.path.join(".");
    return {
      ok: false,
      error:
        field === "webhookUrl"
          ? "The webhook URL must be a full link starting with https://, or blank."
          : field === "daily.drawTime"
            ? "Daily draw: enter the draw time as HH:MM in 24-hour time, e.g. 21:00."
            : field?.startsWith("daily.sources")
              ? "Daily draw: every product source needs a product type."
              : `Settings (${field}): ${issue(settings.error)}`,
    };
  }

  const daily = settings.data.daily;
  if (daily.enabled && daily.minPrice > daily.maxPrice) {
    return {
      ok: false,
      error: "Daily draw: the minimum price can't be above the maximum.",
    };
  }

  return {
    ok: true,
    value: {
      title,
      slug,
      prize: values.prize.trim() || null,
      description: values.description.trim() || null,
      startsAt: startsAt ?? null,
      endsAt: endsAt ?? null,
      timezone,
      rulesText: values.rulesText.trim() || null,
      purchaseRules: rules.value,
      settings: settings.data,
      actions: actions.value,
      removeImage: values.removeImage,
    },
  };
}

/** Picks product or variant GIDs from an App Bridge resource picker selection. */
export function targetFromSelection(
  selection: {
    id: string;
    title?: string;
    totalVariants?: number;
    hasOnlyDefaultVariant?: boolean;
    variants?: { id?: string; title?: string }[];
  }[],
): { target: TargetForm; labels: ResourceLabels } {
  const target = emptyTarget();
  const labels: ResourceLabels = {};
  for (const p of selection) {
    const variants = (p.variants ?? []).filter((v) => v.id);
    const whole =
      p.hasOnlyDefaultVariant ||
      variants.length === 0 ||
      (p.totalVariants !== undefined && variants.length >= p.totalVariants);
    labels[p.id] = { title: p.title ?? p.id };
    if (whole) {
      target.productIds.push(p.id);
    } else {
      for (const v of variants) {
        target.variantIds.push(v.id!);
        labels[v.id!] = {
          title: `${p.title ?? "Product"} – ${v.title ?? "variant"}`,
          productId: p.id,
        };
      }
    }
  }
  return { target, labels };
}

/** Pre-selection for the resource picker from stored GIDs. */
export function selectionIds(t: TargetForm, labels: ResourceLabels) {
  const byProduct = new Map<string, { id: string }[]>();
  for (const id of t.productIds) byProduct.set(id, []);
  for (const v of t.variantIds) {
    const pid = labels[v]?.productId;
    if (!pid) continue;
    byProduct.set(pid, [...(byProduct.get(pid) ?? []), { id: v }]);
  }
  return [...byProduct].map(([id, variants]) =>
    variants.length ? { id, variants } : { id },
  );
}

// ---------------------------------------------------------------------------
// Official rules generator

const easternDate = (d: Date) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Drafts official rules from the editor state; the merchant edits from there. */
export function generateOfficialRules(values: CampaignFormValues): string {
  const tz = values.timezone || DEFAULT_TIMEZONE;
  const title = values.title.trim() || "the Giveaway";
  const starts = parseLocalDateTime(values.startsAt, tz);
  const ends = parseLocalDateTime(values.endsAt, tz);
  const period =
    starts && ends
      ? `begins at ${easternDate(starts)} and ends at ${easternDate(ends)}`
      : starts
        ? `begins at ${easternDate(starts)} and ends when the Sponsor closes it`
        : ends
          ? `begins when the Sponsor opens it and ends at ${easternDate(ends)}`
          : "runs for the dates shown on the giveaway page";
  const eligibility =
    values.settings.eligibility.trim() ||
    campaignSettingsSchema.parse({}).eligibility;
  const prize = values.prize.trim() || "the prize shown on the giveaway page";
  const entriesWord = (n: number) => (n === 1 ? "1 entry" : `${n} entries`);
  const actions = values.actions;
  const signup = actions.find((a) => a.type === "SIGNUP");
  const amoe = actions.find((a) => a.type === "ALTERNATE_ENTRY");
  const ways = actions
    .filter((a) => a.type !== "SIGNUP" && a.type !== "ALTERNATE_ENTRY")
    .map(
      (a) =>
        `- ${a.label.trim() || ACTION_META[a.type].name}: ${entriesWord(a.entries)}${
          a.config.daily && a.config.schedule
            ? " per scheduled live show window"
            : a.type === "DAILY_CHECKIN" || a.repeatable || a.config.daily
              ? " per day"
              : ""
        }${a.type === "REFERRAL" ? " per verified referral" : ""}`,
    );
  const dailyTasks = actions.some((a) => a.config.daily);
  // Free steps every entrant must also complete before their entries count in a drawing.
  const steps = [
    values.settings.requireEmailConsent
      ? "agree to receive marketing emails from the Sponsor (you can unsubscribe at any time after entering)"
      : "",
    ...actions
      .filter(
        (a) =>
          a.mandatory &&
          !["SIGNUP", "REFERRAL", "ALTERNATE_ENTRY"].includes(a.type),
      )
      .map((a) => (a.label.trim() || ACTION_META[a.type].name).toLowerCase()),
  ].filter(Boolean);
  const purchases = values.rules.enabled;
  const claimDays = values.settings.winnerEmail.claimDays;
  // A daily giveaway holds a separate drawing every day from that day's entries only.
  const daily = values.settings.daily.enabled;
  const [h, m] = values.settings.daily.drawTime.split(":").map(Number);
  const drawTime = `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  const zone = tz === "America/New_York" ? "Eastern Time" : tz;

  // Signing up on the giveaway page is free, so it is the free method of entry unless the
  // merchant adds separate instructions (e.g. a mail-in address) on an alternate entry action.
  const freeMethod = amoe?.config.instructions?.trim()
    ? `${amoe.config.instructions.trim()} This free method earns ${entriesWord(amoe.entries)}${
        purchases
          ? ", and no purchase is required to receive the same opportunity to win as entrants who make a purchase"
          : ""
      }.`
    : `Sign up for free with your email on the giveaway page. No purchase is required, and free entrants can earn bonus entries through the free actions listed below${
        purchases
          ? "; a purchase does not give a better chance of winning than the entries described in these rules"
          : ""
      }.`;

  const sections = [
    `${title.toUpperCase()} – OFFICIAL RULES`,
    purchases
      ? "NO PURCHASE NECESSARY TO ENTER OR WIN. A FREE METHOD OF ENTRY IS AVAILABLE (SEE SECTION 4). VOID WHERE PROHIBITED."
      : "NO PURCHASE NECESSARY TO ENTER OR WIN. A PURCHASE WILL NOT INCREASE YOUR CHANCES OF WINNING. VOID WHERE PROHIBITED.",
    `1. Sponsor. ${title} (the "Giveaway") is sponsored by ${SPONSOR} (the "Sponsor"). The Giveaway is not sponsored, endorsed or administered by, or associated with, Shopify, Instagram, TikTok, Facebook, X, The Pokémon Company or Nintendo.`,
    `2. Eligibility. Open only to ${eligibility}. Employees of the Sponsor and their immediate family and household members are not eligible. Limit one sign-up per person and email address.${values.settings.usOnly ? " Entrants must have a shipping address in the 50 United States or the District of Columbia; prizes are shipped only to such addresses, and purchases shipped outside the United States do not earn entries." : ""}`,
    daily
      ? `3. Entry period and daily drawings. The Giveaway ${period} (Eastern Time). It is made up of separate daily drawings. Each daily drawing takes place at ${drawTime} ${zone} and its entry period runs from just after ${drawTime} on the previous day until ${drawTime} on the day of the drawing. Only entries earned during that period count toward that day's drawing; entries do not carry over from one day to the next. The Sponsor's clock is the official timekeeper.`
      : `3. Entry period. The Giveaway ${period} (Eastern Time). The Sponsor's clock is the official timekeeper.`,
    [
      "4. How to enter.",
      `Free entry: ${freeMethod}`,
      signup
        ? `Signing up and verifying your email earns ${entriesWord(signup.entries)}.`
        : "",
      steps.length
        ? `To complete an entry, entrants must also ${steps.join(" and ")}. These steps are free. Entries count in a drawing only once they are done.`
        : "",
      ways.length ? `Bonus entries are available for:\n${ways.join("\n")}` : "",
      dailyTasks
        ? `Daily tasks become available after an entrant completes the one-time social follow tasks, and each can be completed once per ${values.settings.daily.enabled && values.settings.dailyTasks.resetAt === "draw" ? "daily drawing period" : "day (days reset at midnight Central Time)"}. Tasks that ask entrants to engage with social media content are completed on the entrant's word; the Sponsor does not verify likes, comments or live-show attendance and may disqualify anyone who claims them falsely.`
        : "",
      purchases
        ? "Purchases from the Sponsor's store during the entry period may earn bonus entries as described on the giveaway page. Cancelled or edited orders lose the entries they earned."
        : "",
      "Entries generated by script, bot, multiple or fake accounts, or any other automated or fraudulent means are void, and the Sponsor may disqualify anyone it believes has tampered with the Giveaway.",
    ]
      .filter(Boolean)
      .join("\n"),
    daily
      ? `5. Prizes. One prize is awarded in each daily drawing: the product shown as that day's prize on the giveaway page.${values.description.trim() ? ` ${values.description.trim()}` : ""} No substitution, transfer or cash equivalent, except that the Sponsor may substitute a prize of equal or greater value. Winners are responsible for any taxes.`
      : `5. Prize. ${prize}.${values.description.trim() ? ` ${values.description.trim()}` : ""} No substitution, transfer or cash equivalent, except that the Sponsor may substitute a prize of equal or greater value. Winners are responsible for any taxes.`,
    daily
      ? "6. Odds. Odds of winning a daily drawing depend on the total number of eligible entries received during that drawing's entry period."
      : "6. Odds. Odds of winning depend on the total number of eligible entries received during the entry period.",
    `7. Winner selection and notification. ${
      daily
        ? "Each day's winner is selected at the time of that day's drawing in a random drawing, weighted by entries, from the eligible entries earned during that day's entry period."
        : "Winners are selected in a random drawing, weighted by entries, from all eligible entries after the entry period ends."
    } Winners are notified by email and must confirm their details within ${plural(claimDays, "day")}, or the prize may be forfeited and an alternate winner drawn.`,
    "8. General. By entering, entrants agree to these rules and the Sponsor's decisions, which are final. The Sponsor may cancel, suspend or modify the Giveaway if fraud, technical failure or any other factor impairs its integrity. Entrants release the Sponsor, and Instagram, Facebook, Whatnot and any other social platform used in the Giveaway, from liability for any injury, loss or damage arising from participation or from accepting or using a prize.",
    "9. Privacy. Information collected is used to administer the Giveaway and as described in the Sponsor's privacy policy. Entrants who opt in may receive marketing emails and can unsubscribe at any time.",
    `10. Winners list. For the names of winners, contact ${SPONSOR} through its store within 30 days after the entry period ends.`,
  ];
  return sections.join("\n\n");
}
