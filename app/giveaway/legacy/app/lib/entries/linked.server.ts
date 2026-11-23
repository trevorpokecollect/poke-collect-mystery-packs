import { randomBytes } from "node:crypto";
import type { Campaign, EntryAction, Entrant } from "@prisma/client";
import db from "../../db.server";
import { parseSettings } from "../settings";
import { slugify } from "../slug";
import { award } from "./ledger.server";
import { isArchived } from "./actions";
import { actionDedupeKey, repeatSuffix } from "./repeat";

// Linked giveaways (settings.linkedSlug, set on either one): typically the monthly giveaway
// that ads drive to and the daily one in the popup.
// - Verifying for one enters the person in the other too (same email, no second code).
// - Texts, follows of the same link and daily check-ins count in both.
// Purchases already count in every live giveaway (see orders.server.ts).

type CampaignWithActions = Campaign & { actions: EntryAction[] };

const isOpen = (c: Campaign, now = new Date()) =>
  c.status === "ACTIVE" &&
  (!c.startsAt || c.startsAt <= now) &&
  (!c.endsAt || c.endsAt >= now);

/** The open giveaway linked to this one, from either side's setting. */
export async function linkedCampaign(
  campaign: Campaign,
): Promise<CampaignWithActions | null> {
  const include = { actions: true };
  const own = slugify(parseSettings(campaign.settings).linkedSlug);
  // The setting holds the link name as the merchant typed it ("Monthly Giveaway"), so the
  // reverse lookup compares in code rather than in the JSON query.
  const other = own
    ? await db.campaign.findUnique({
        where: { shop_slug: { shop: campaign.shop, slug: own } },
        include,
      })
    : ((
        await db.campaign.findMany({
          where: {
            shop: campaign.shop,
            id: { not: campaign.id },
            status: "ACTIVE",
            NOT: { settings: { path: ["linkedSlug"], equals: "" } },
          },
          orderBy: { createdAt: "desc" },
          include,
        })
      ).find(
        (c) => slugify(parseSettings(c.settings).linkedSlug) === campaign.slug,
      ) ?? null);
  return other && other.id !== campaign.id && isOpen(other) ? other : null;
}

// Actions that mean the same thing in both giveaways.
function shareKey(a: EntryAction) {
  if (isArchived(a)) return null;
  if (a.type === "SMS_OPTIN" || a.type === "DAILY_CHECKIN") return a.type;
  if (a.type === "SOCIAL_FOLLOW") {
    const url = (a.config as { url?: string } | null)?.url ?? "";
    try {
      const u = new URL(url);
      return `follow:${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "").toLowerCase()}`;
    } catch {
      return null;
    }
  }
  return null;
}

const matching = (a: EntryAction, actions: EntryAction[]) => {
  const key = shareKey(a);
  return key ? (actions.find((b) => shareKey(b) === key) ?? null) : null;
};

/** Awards `action` (from the other giveaway) to `entrant` with its own dedupe key. */
async function awardMirrored(
  campaign: Campaign,
  entrant: Entrant,
  action: EntryAction,
) {
  const repeats = action.type === "DAILY_CHECKIN" || action.repeatable;
  return award({
    campaignId: campaign.id,
    entrantId: entrant.id,
    entries: action.entries,
    source: "ACTION",
    actionId: action.id,
    note: "counted from the linked giveaway",
    dedupeKey: actionDedupeKey(
      action.id,
      entrant.id,
      repeatSuffix(campaign, repeats),
    ),
  });
}

async function copySms(from: Entrant, to: Entrant) {
  if (!from.phone || !from.smsConsentAt || to.smsConsentAt) return;
  const taken = await db.entrant.findFirst({
    where: { campaignId: to.campaignId, phone: from.phone, id: { not: to.id } },
    select: { id: true },
  });
  if (taken) return;
  await db.entrant.update({
    where: { id: to.id },
    data: { phone: from.phone, smsConsentAt: from.smsConsentAt },
  });
}

/** The same person's ACTIVE entry in the linked giveaway, if both exist. */
async function partnerOf(entrantId: string) {
  const entrant = await db.entrant.findUnique({
    where: { id: entrantId },
    include: { campaign: { include: { actions: true } } },
  });
  if (!entrant || entrant.status !== "ACTIVE") return null;
  const other = await linkedCampaign(entrant.campaign);
  if (!other) return null;
  const partner = await db.entrant.findUnique({
    where: {
      campaignId_emailNormalized: {
        campaignId: other.id,
        emailNormalized: entrant.emailNormalized,
      },
    },
  });
  if (!partner || partner.status !== "ACTIVE") return null;
  return { entrant, partner, other };
}

/** After an action is earned: credits the matching action in the linked giveaway. */
export async function mirrorAction(entrantId: string, actionId: string) {
  const pair = await partnerOf(entrantId);
  if (!pair) return false;
  const action = pair.entrant.campaign.actions.find((a) => a.id === actionId);
  const target = action && matching(action, pair.other.actions);
  if (!target) return false;
  if (target.type === "SMS_OPTIN") {
    const fresh = await db.entrant.findUniqueOrThrow({
      where: { id: entrantId },
    });
    await copySms(fresh, pair.partner);
  }
  return awardMirrored(pair.other, pair.partner, target);
}

/** Credits one-time shared actions (texts, follows) done in either giveaway to the other. */
async function syncShared(
  a: Entrant & { campaign: CampaignWithActions },
  b: Entrant,
  other: CampaignWithActions,
) {
  const done = async (entrantId: string) =>
    new Set(
      (
        await db.entryEvent.findMany({
          where: { entrantId, actionId: { not: null } },
          select: { actionId: true },
        })
      ).map((e) => e.actionId),
    );
  const [doneA, doneB] = await Promise.all([done(a.id), done(b.id)]);
  for (const action of a.campaign.actions) {
    if (action.type === "DAILY_CHECKIN") continue; // per day, mirrored as they happen
    const target = matching(action, other.actions);
    if (!target) continue;
    if (doneA.has(action.id) && !doneB.has(target.id))
      await awardMirrored(other, b, target);
    if (doneB.has(target.id) && !doneA.has(action.id))
      await awardMirrored(a.campaign, a, action);
  }
}

/**
 * Called when an entrant is activated (verified): enters them in the linked giveaway too,
 * with the same details and no second verification, then lines up shared actions.
 * `activate` is signup.server's, passed in to avoid an import cycle; it is called with
 * mirror off so the two giveaways don't keep activating each other.
 */
export async function mirrorEntrant(
  entrantId: string,
  activate: (id: string, opts: { mirror: boolean }) => Promise<void>,
) {
  const entrant = await db.entrant.findUnique({
    where: { id: entrantId },
    include: { campaign: { include: { actions: true } } },
  });
  if (!entrant || entrant.status !== "ACTIVE") return null;
  const other = await linkedCampaign(entrant.campaign);
  if (!other) return null;

  let partner = await db.entrant.findUnique({
    where: {
      campaignId_emailNormalized: {
        campaignId: other.id,
        emailNormalized: entrant.emailNormalized,
      },
    },
  });
  if (!partner) {
    try {
      partner = await db.entrant.create({
        data: {
          campaignId: other.id,
          email: entrant.email,
          emailNormalized: entrant.emailNormalized,
          name: entrant.name,
          shopifyCustomerId: entrant.shopifyCustomerId,
          status: "ACTIVE",
          verifiedAt: new Date(),
          referralCode: randomBytes(5).toString("base64url"),
          riskScore: entrant.riskScore,
          ipHash: entrant.ipHash,
          subnetHash: entrant.subnetHash,
          deviceHash: entrant.deviceHash,
          userAgent: entrant.userAgent,
          utm: entrant.utm ?? undefined,
          marketingConsent: entrant.marketingConsent,
        },
      });
      await copySms(entrant, partner);
      await activate(partner.id, { mirror: false });
    } catch (err) {
      // Created at the same moment by a parallel request: use that one.
      if ((err as { code?: string }).code !== "P2002") throw err;
      partner = await db.entrant.findUnique({
        where: {
          campaignId_emailNormalized: {
            campaignId: other.id,
            emailNormalized: entrant.emailNormalized,
          },
        },
      });
    }
  } else if (partner.status === "PENDING_VERIFICATION") {
    // They just proved they own this email, which covers the other giveaway too.
    await activate(partner.id, { mirror: false });
  }
  if (!partner) return null;
  partner = await db.entrant.findUniqueOrThrow({ where: { id: partner.id } });
  if (partner.status !== "ACTIVE") return null;
  await syncShared(entrant, partner, other);
  return partner;
}

/**
 * For the storefront: someone already entered in the linked giveaway (proven by its signed
 * token) is recognized here too, entering them first if needed. Returns this giveaway's entrant.
 */
export async function entrantFromLinked(
  campaign: Campaign,
  linkedEntrantId: string,
  linkedCampaignId: string,
  activate: (id: string, opts: { mirror: boolean }) => Promise<void>,
) {
  const other = await linkedCampaign(campaign);
  if (!other || other.id !== linkedCampaignId) return null;
  const source = await db.entrant.findUnique({
    where: { id: linkedEntrantId },
  });
  if (!source || source.campaignId !== other.id || source.status !== "ACTIVE")
    return null;
  const here = await db.entrant.findUnique({
    where: {
      campaignId_emailNormalized: {
        campaignId: campaign.id,
        emailNormalized: source.emailNormalized,
      },
    },
  });
  if (here?.status === "ACTIVE") return here;
  if (here && here.status !== "PENDING_VERIFICATION") return null;
  return mirrorEntrant(source.id, activate);
}
