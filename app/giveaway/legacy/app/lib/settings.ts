import { z } from "zod";

// Per-campaign settings stored as JSON on Campaign.settings.
export const campaignSettingsSchema = z.object({
  winnerEmail: z
    .object({
      enabled: z.boolean().default(true),
      subject: z.string().default("You won {{prize}}!"),
      body: z
        .string()
        .default(
          "Congratulations! You won {{prize}} in {{title}}. Confirm your shipping details here: {{claim_url}}",
        ),
      claimDays: z.number().int().positive().default(7),
    })
    .prefault({}),
  consolation: z
    .object({
      enabled: z.boolean().default(false),
      percentOff: z.number().min(1).max(100).default(10),
      daysValid: z.number().int().positive().default(14),
      minEntries: z.number().int().nonnegative().default(1),
    })
    .prefault({}),
  klaviyo: z
    .object({
      enabled: z.boolean().default(false),
      listId: z.string().default(""),
      onlyConsented: z.boolean().default(true),
    })
    .prefault({}),
  // Daily draw: a different in-stock product is picked and reserved as each day's prize,
  // and drawn at drawTime from the entries earned that day. See app/lib/daily.server.ts.
  daily: z
    .object({
      enabled: z.boolean().default(false),
      // "HH:mm" in the campaign timezone.
      drawTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .default("21:00"),
      minPrice: z.number().nonnegative().default(70),
      maxPrice: z.number().nonnegative().default(100),
      // Which products can be picked: a Shopify product type, optionally limited to
      // languages (matched against the StorePass "Language_<name>" tag). Blank = any.
      sources: z
        .array(
          z.object({
            productType: z.string().min(1),
            languages: z.string().default(""),
          }),
        )
        .default([
          { productType: "Pokemon Sealed", languages: "" },
          { productType: "Pokemon Single", languages: "English" },
        ]),
      // Don't pick the same product again within this many days.
      noRepeatDays: z.number().int().nonnegative().default(30),
      // A daily winner can't win another daily prize within this many days.
      winCooldownDays: z.number().int().nonnegative().default(30),
      // Let the automatic pick use products whose only stock is safety stock. Products the
      // merchant picks (the upcoming list, Choose product) can always use it.
      useSafetyStock: z.boolean().default(false),
    })
    .prefault({}),
  // "Shop & earn" under the bonus entries: the purchase-entry rate, a Shop now link and a few
  // example products with the entries each earns. See app/lib/storefront/shop-promo.server.ts.
  shop: z
    .object({
      enabled: z.boolean().default(true),
      url: z.string().default("/collections/all"),
      products: z
        .array(
          z.object({
            id: z.string(),
            title: z.string().default(""),
            imageUrl: z.string().nullable().default(null),
            // When picked; only the admin preview uses it, the store shows live prices.
            price: z.number().nonnegative().default(0),
          }),
        )
        .max(6)
        .default([]),
    })
    .prefault({}),
  // Daily Tasks (actions with config.daily): when they reset. "draw" = at the daily draw, so
  // each task pays once per draw; "midnight" = midnight Central. Giveaways without a daily
  // draw always use midnight Central. See app/lib/daily-tasks.ts.
  dailyTasks: z
    .object({
      resetAt: z.enum(["draw", "midnight"]).default("draw"),
    })
    .prefault({}),
  webhookUrl: z.string().url().or(z.literal("")).default(""),
  showLeaderboard: z.boolean().default(false),
  showWinners: z.boolean().default(true),
  // Backdrop behind the giveaway's own prize image: "light" (white box), or "rain" = the daily
  // prize's stage (red digital rain, glow, floating image).
  imageBackdrop: z.enum(["light", "rain"]).catch("light"),
  // The storefront "Giveaway Winners" page the widget's "See All Winners" button opens.
  winnersPageUrl: z.string().default("/pages/giveaway-info-winners"),
  // Link name of a partner giveaway (e.g. the daily for a monthly). Signing up for one
  // enters both, and texts, follows and check-ins count in both. Set on either side.
  // See app/lib/entries/linked.server.ts.
  linkedSlug: z.string().default(""),
  // The "Email me deals" box must be ticked to enter (and to be in the draw).
  requireEmailConsent: z.boolean().default(false),
  // Only people in the US with a US shipping address may enter: a required "I live in the US"
  // box at sign-up, winners must claim with a US address (50 states + DC), and orders shipping
  // abroad earn no purchase entries. See app/lib/us-only.ts.
  usOnly: z.boolean().default(true),
  // First and last name on the sign-up form, so winners can be shown as "Emily S.".
  requireName: z.boolean().default(true),
  // Who may enter, used by the official rules generator in the editor.
  eligibility: z
    .string()
    .default(
      "legal residents of the 50 United States and the District of Columbia who are 18 years of age or older",
    ),
});

export type CampaignSettings = z.infer<typeof campaignSettingsSchema>;

export const parseSettings = (raw: unknown): CampaignSettings =>
  campaignSettingsSchema.parse(raw ?? {});

/**
 * EntryAction.config shapes by type (validated where actions are saved):
 * SOCIAL_FOLLOW / VISIT_URL: { url }
 * WATCH_VIDEO: { url, seconds? }  (entrant must keep the video open `seconds`)
 * SOCIAL_SHARE: { network?: "x" | "facebook" | "any" }
 * SECRET_CODE: { code }
 * POLL: { question, options: string[] }
 * QUESTION: { question, answer? }  (answer set = quiz, must match case-insensitively)
 * ALTERNATE_ENTRY: { instructions? }  (free method of entry, quoted in the official rules)
 * SMS_OPTIN: { disclosure? }  (consent wording next to the checkbox; blank = DEFAULT_SMS_DISCLOSURE)
 * DAILY_CHECKIN, SIGNUP, REFERRAL: none
 *
 * VISIT_URL, SOCIAL_FOLLOW, WATCH_VIDEO, SECRET_CODE and DAILY_CHECKIN may also carry the
 * Daily Task fields (`taskFields` below): daily, urls (extra links rotated by day), confirm
 * (claim button text after opening the link), schedule (weekly Central window), live, paused.
 *
 * Any type may also carry `archived: true`. The editor sets it (with entries 0)
 * instead of deleting an action that already has EntryEvents, so the ledger
 * keeps its actionId. Archived actions must not be shown on the storefront or
 * awarded again; use isArchivedAction().
 */
const hm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use a time like 17:00");

const taskFields = {
  daily: z.boolean().optional(),
  urls: z.array(z.string().url()).max(31).optional(),
  confirm: z.string().max(60).optional(),
  schedule: z
    .object({
      days: z.array(z.number().int().min(0).max(6)).min(1),
      start: hm,
      end: hm,
    })
    .refine((s) => s.start < s.end, "the end time must be after the start")
    .optional(),
  live: z.boolean().optional(),
  paused: z.boolean().optional(),
  // Open the newest post on our Instagram instead of the link (app/lib/instagram.server.ts).
  latestInstagram: z.boolean().optional(),
  // Only pays when the buylist app has a real submission from the entrant's email in this task
  // day (app/lib/buylist-verify.server.ts).
  verifyBuylist: z.boolean().optional(),
  // Only pays when Vault Market (Mystery Packs app) has a listing from the entrant since the task
  // day began (app/lib/market-verify.server.ts).
  verifyMarketListing: z.boolean().optional(),
};

export const actionConfigSchema = {
  SOCIAL_FOLLOW: z.object({ url: z.string().url(), ...taskFields }),
  VISIT_URL: z.object({ url: z.string().url(), ...taskFields }),
  DAILY_CHECKIN: z.object(taskFields),
  WATCH_VIDEO: z.object({
    url: z.string().url(),
    seconds: z.number().int().nonnegative().optional(),
    ...taskFields,
  }),
  SOCIAL_SHARE: z.object({
    network: z.enum(["x", "facebook", "any"]).default("any"),
  }),
  SECRET_CODE: z.object({ code: z.string().min(1), ...taskFields }),
  POLL: z.object({
    question: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).max(10),
  }),
  QUESTION: z.object({
    question: z.string().min(1),
    answer: z.string().optional(),
  }),
  ALTERNATE_ENTRY: z.object({ instructions: z.string().optional() }),
  SMS_OPTIN: z.object({ disclosure: z.string().optional() }),
} as const;

export const isArchivedAction = (config: unknown) =>
  !!config &&
  typeof config === "object" &&
  (config as { archived?: unknown }).archived === true;
