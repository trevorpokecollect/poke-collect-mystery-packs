import db from "../db.server";
import { entrantTotal } from "./entries/ledger.server";
import { parseSettings } from "./settings";

// Klaviyo sync for entrants of campaigns with settings.klaviyo.enabled.
// Uses the REST API (https://developers.klaviyo.com/en/reference/api_overview)
// with the private key in KLAVIYO_PRIVATE_KEY:
//   POST /api/profile-import                          upsert profile + properties
//   POST /api/profile-subscription-bulk-create-jobs   subscribe consented email (to listId) and SMS
//   POST /api/lists/{id}/relationships/profiles       add (not subscribe) to listId
//   POST /api/events                                  "Entered Giveaway"

const BASE = "https://a.klaviyo.com/api";
const REVISION = "2026-07-15";
const TIMEOUT_MS = 8000;

async function klaviyo(path: string, body: unknown, attempt = 0) {
  const key = process.env.CARDBIT_GIVEAWAY_KLAVIYO_PRIVATE_KEY;
  if (!key) throw new Error("KLAVIYO_PRIVATE_KEY is not set");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Klaviyo-API-Key ${key}`,
      revision: REVISION,
      accept: "application/vnd.api+json",
      "content-type": "application/vnd.api+json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // Back off once on rate limiting, honouring Retry-After (seconds).
  if (res.status === 429 && attempt === 0) {
    const wait = Math.min(10, Number(res.headers.get("retry-after")) || 1);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return klaviyo(path, body, 1);
  }
  if (!res.ok)
    throw new Error(`Klaviyo ${path} ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

const splitName = (name: string | null) => {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length
    ? { first_name: parts[0], last_name: parts.slice(1).join(" ") || undefined }
    : {};
};

/**
 * Pushes one entrant to Klaviyo. Returns false when the campaign has Klaviyo
 * off, the entrant isn't ACTIVE, or onlyConsented excludes them.
 */
export async function syncEntrantToKlaviyo(entrantId: string) {
  const entrant = await db.entrant.findUnique({
    where: { id: entrantId },
    include: { campaign: true },
  });
  if (!entrant || entrant.status !== "ACTIVE") return false;
  const { klaviyo: cfg } = parseSettings(entrant.campaign.settings);
  if (!cfg.enabled || !process.env.CARDBIT_GIVEAWAY_KLAVIYO_PRIVATE_KEY) return false;
  const sms = !!entrant.smsConsentAt && !!entrant.phone;
  if (cfg.onlyConsented && !entrant.marketingConsent && !sms) return false;

  const entries = await entrantTotal(entrant.id);
  const giveaway = entrant.campaign.title;
  const profile = await klaviyo("/profile-import", {
    data: {
      type: "profile",
      attributes: {
        email: entrant.email,
        ...(sms ? { phone_number: entrant.phone } : {}),
        ...splitName(entrant.name),
        properties: {
          "Giveaway Title": giveaway,
          "Giveaway Entries": entries,
          "Giveaway Referral Code": entrant.referralCode,
          ...(sms ? { "Giveaway SMS Opt-in": true } : {}),
        },
      },
    },
  });
  const profileId = (profile as { data?: { id?: string } } | null)?.data?.id;

  // Subscribe only the channels the entrant agreed to: email from the sign-up box,
  // SMS from the text opt-in action. SMS doesn't need a list (Klaviyo records it on
  // the profile), so it's sent even when no list is set.
  const email = entrant.marketingConsent && !!cfg.listId;
  if (email || sms) {
    await klaviyo("/profile-subscription-bulk-create-jobs", {
      data: {
        type: "profile-subscription-bulk-create-job",
        attributes: {
          custom_source: `Giveaway: ${giveaway}`,
          profiles: {
            data: [
              {
                type: "profile",
                attributes: {
                  email: entrant.email,
                  ...(sms ? { phone_number: entrant.phone } : {}),
                  subscriptions: {
                    ...(email
                      ? { email: { marketing: { consent: "SUBSCRIBED" } } }
                      : {}),
                    ...(sms
                      ? { sms: { marketing: { consent: "SUBSCRIBED" } } }
                      : {}),
                  },
                },
              },
            ],
          },
        },
        ...(cfg.listId
          ? {
              relationships: {
                list: { data: { type: "list", id: cfg.listId } },
              },
            }
          : {}),
      },
    });
  }
  if (cfg.listId && !entrant.marketingConsent && profileId) {
    // No email consent: list membership only, no email subscription.
    await klaviyo(
      `/lists/${encodeURIComponent(cfg.listId)}/relationships/profiles`,
      { data: [{ type: "profile", id: profileId }] },
    );
  }

  await klaviyo("/events", {
    data: {
      type: "event",
      attributes: {
        properties: {
          "Giveaway Title": giveaway,
          "Giveaway Slug": entrant.campaign.slug,
          Entries: entries,
          "Referral Code": entrant.referralCode,
        },
        metric: {
          data: { type: "metric", attributes: { name: "Entered Giveaway" } },
        },
        profile: {
          data: { type: "profile", attributes: { email: entrant.email } },
        },
        // Klaviyo de-duplicates on unique_id, so re-syncs don't double count.
        unique_id: `entered:${entrant.id}`,
      },
    },
  });

  await db.entrant.update({
    where: { id: entrant.id },
    data: { klaviyoSyncedAt: new Date() },
  });
  return true;
}

/** Fire-and-forget hook for activate(); never throws or delays the entry. */
export function queueKlaviyoSync(entrantId: string) {
  syncEntrantToKlaviyo(entrantId).catch((err) =>
    console.warn(
      `[klaviyo] sync ${entrantId} failed: ${(err as Error).message}`,
    ),
  );
}

/**
 * Re-syncs every ACTIVE entrant of a campaign in the background, a few at a
 * time to stay well under Klaviyo's rate limits. Returns how many are queued.
 */
export async function syncCampaignToKlaviyo(campaignId: string) {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return { error: "Giveaway not found." };
  if (!parseSettings(campaign.settings).klaviyo.enabled)
    return { error: "Turn on Klaviyo in this giveaway's settings first." };
  if (!process.env.CARDBIT_GIVEAWAY_KLAVIYO_PRIVATE_KEY)
    return { error: "KLAVIYO_PRIVATE_KEY isn't set on the server." };
  const ids = (
    await db.entrant.findMany({
      where: { campaignId, status: "ACTIVE" },
      select: { id: true },
    })
  ).map((e) => e.id);

  void (async () => {
    const CONCURRENCY = 4;
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      await Promise.all(
        ids
          .slice(i, i + CONCURRENCY)
          .map((id) =>
            syncEntrantToKlaviyo(id).catch((err) =>
              console.warn(
                `[klaviyo] sync ${id} failed: ${(err as Error).message}`,
              ),
            ),
          ),
      );
      await new Promise((r) => setTimeout(r, 250));
    }
  })();
  return { queued: ids.length };
}
