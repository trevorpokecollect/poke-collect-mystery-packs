import giveawayDb from "../db.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { clientIp } from "../lib/bot/fingerprint.server";
import {
  completeAction,
  entrantState,
  leaderboardRows,
  markYou,
  verifyEntrant,
} from "../lib/entries/actions.server";
import { publicAction, visibleActions } from "../lib/entries/actions";
import {
  activate,
  enterToday,
  findLiveCampaign,
  signup,
} from "../lib/entries/signup.server";
import {
  entrantFromLinked,
  linkedCampaign,
} from "../lib/entries/linked.server";
import { publicWinners } from "../lib/winners.server";
import {
  currentPrize,
  storefrontDaily,
  storefrontDailyEntrant,
} from "../lib/daily.server";
import { issueEntrantToken, readEntrantToken } from "../lib/token.server";
import { campaignSettingsSchema, parseSettings } from "../lib/settings";
import {
  landingPage,
  wantsLandingPage,
} from "../lib/storefront/landing.server";
import { shopPromo } from "../lib/storefront/shop-promo.server";
import { burstCache } from "../lib/storefront/burst-cache";
import { liveCampaignShared } from "../lib/storefront/live-campaign.server";
import {
  customerGid,
  fullName,
  shopCustomer,
  tokenForCustomer,
} from "../lib/storefront/customer.server";

// Storefront API, reached through the Shopify app proxy at /apps/packs/campaigns/<slug>.
// Shopify signs every proxied request, and authenticate.public.appProxy checks it.

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

function shopFrom(request: Request) {
  return new URL(request.url).searchParams.get("shop") ?? "";
}

// The parts of the popup's data that are the same for every shopper, shared for a few
// seconds so a text or email blast doesn't run every lookup once per page load.
const shared = burstCache(10_000);

type LiveCampaign = NonNullable<Awaited<ReturnType<typeof findLiveCampaign>>>;

const publicState = (campaign: LiveCampaign) =>
  shared.get(`public:${campaign.id}`, async () => {
    const linked = await linkedCampaign(campaign);
    const linkedDaily = linked && (await currentPrize(linked));
    const settings = parseSettings(campaign.settings);
    return {
      // The giveaway this one is linked to (one sign-up enters both), for the "you're also in" note.
      linked: linked
        ? {
            title: linked.title,
            slug: linked.slug,
            daily: !!linkedDaily,
            prize: linkedDaily?.prize?.title ?? null,
          }
        : null,
      campaign: {
        title: campaign.title,
        description: campaign.description,
        prize: campaign.prize,
        imageUrl: campaign.imageUrl,
        endsAt: campaign.endsAt,
        rulesText: campaign.rulesText,
        requireEmailConsent: settings.requireEmailConsent,
        requireName: settings.requireName,
        usOnly: settings.usOnly,
        // "See All Winners" button (null hides it).
        winnersPage: (settings.showWinners && settings.winnersPageUrl) || null,
        imageBackdrop: settings.imageBackdrop,
        actions: visibleActions(campaign.actions).map(publicAction),
      },
      // Set for giveaways with the daily draw on: today's prize, when it's drawn, the last winner.
      daily: await storefrontDaily(campaign, null),
      // "Shop & earn" under the bonus entries; null when purchases don't earn entries.
      shop: await shopPromo(campaign),
      leaderboard: campaignSettingsSchema.safeParse(campaign.settings ?? {})
        .data?.showLeaderboard
        ? await leaderboardRows(campaign.id)
        : null,
    };
  });

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  if(params.slug==="daily-cardbits" && wantsLandingPage(request)) return Response.redirect("https://cardbit.com/apps/packs/giveaways",302);
  const campaign = await liveCampaignShared(shopFrom(request), params.slug!);
  // Opened directly in the browser: a full page in the store's theme that mounts the widget.
  if (wantsLandingPage(request)) {
    return landingPage({
      slug: params.slug!,
      pathPrefix: new URL(request.url).searchParams.get("path_prefix"),
      campaign,
    });
  }
  if (!campaign)
    return json(
      {
        error: "This giveaway isn't open right now.",
        // Set (as [{ position, name: "Ash K." }]) when the giveaway has ENDED and showWinners is on.
        winners: await publicWinners(shopFrom(request), params.slug!),
      },
      404,
    );

  let token = request.headers.get("x-entrant-token");
  const t = readEntrantToken(token);
  let entrantId = t?.campaignId === campaign.id ? t.entrantId : null;
  // Not entered here yet, but entered in the linked giveaway: count them in this one too
  // (no second form) and hand back a token for it.
  let linkedToken: string | null = null;
  if (!entrantId) {
    for (const raw of (request.headers.get("x-linked-tokens") ?? "")
      .split(",")
      .slice(0, 5)) {
      const lt = readEntrantToken(raw.trim());
      if (!lt || lt.campaignId === campaign.id) continue;
      const here = await entrantFromLinked(
        campaign,
        lt.entrantId,
        lt.campaignId,
        activate,
      );
      if (!here) continue;
      linkedToken = token = issueEntrantToken(here.id, campaign.id);
      entrantId = here.id;
      break;
    }
  }
  // Signed in to their store account: hand back their entry if they have one, else offer
  // the one-tap entry (no email or name to type).
  const customerId = customerGid(
    new URL(request.url).searchParams.get("logged_in_customer_id"),
  );
  let customer: {
    firstName: string | null;
    needsName: boolean;
    needsConsent: boolean;
  } | null = null;
  if (!entrantId && customerId) {
    const shop = shopFrom(request);
    const lookup = () => shopCustomer(shop, customerId).catch(() => null);
    const found = await tokenForCustomer(campaign.id, customerId, lookup);
    const t2 = found && readEntrantToken(found);
    if (found && t2) {
      linkedToken = token = found;
      entrantId = t2.entrantId;
    } else {
      const c = await lookup();
      const settings = parseSettings(campaign.settings);
      if (c?.email)
        customer = {
          firstName: c.firstName,
          needsName: settings.requireName && fullName(c).split(" ").length < 2,
          needsConsent: settings.requireEmailConsent && !c.emailSubscribed,
        };
    }
  }
  const pub = await publicState(campaign);
  const mine = entrantId
    ? await storefrontDailyEntrant(campaign, entrantId)
    : null;
  return json({
    linkedToken,
    linked: pub.linked,
    campaign: pub.campaign,
    turnstileSiteKey: process.env.CARDBIT_GIVEAWAY_TURNSTILE_SITE_KEY ?? null,
    customer,
    entrant: token ? await entrantState(token) : null,
    daily: pub.daily && mine ? { ...pub.daily, ...mine } : pub.daily,
    shop: pub.shop,
    leaderboard: pub.leaderboard && markYou(pub.leaderboard, token),
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = shopFrom(request);
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const str = (k: string) =>
    typeof body[k] === "string" ? (body[k] as string) : undefined;

  const id=customerGid(url.searchParams.get("logged_in_customer_id"));
  const subscriber=id?await shopCustomer(shop,id):null;
  const member=id?await giveawayDb.cardbitGiveawayPerson.findUnique({where:{shop_customerId:{shop,customerId:id}}}):null;
  if(!id || !subscriber?.emailSubscribed || !member?.whatnotAt || member.held) return json({error:"Sign in, enable email marketing, and complete your one-time Whatnot visit on the daily giveaway page."},403);
  if(body.intent==="signup" && subscriber.email?.toLowerCase()!==String(body.email??"").trim().toLowerCase()) return json({error:"Use the email on your signed-in Cardbit account."},403);
  const token=request.headers.get("x-entrant-token");
  if(token && body.intent==="action"){
    const claim=readEntrantToken(token);
    const owner=claim?await giveawayDb.entrant.findFirst({where:{id:claim.entrantId,shopifyCustomerId:id,campaign:{shop}},select:{id:true}}):null;
    if(!owner)return json({error:"Sign in to the giveaway account that owns this entry."},403);
  }
  switch (body.intent) {
    case "signup": {
      const result = await signup({
        shop,
        campaignSlug: params.slug!,
        email: str("email") ?? "",
        name: str("name"),
        referralCode: str("ref"),
        turnstileToken: str("turnstileToken"),
        honeypot: str("website"),
        elapsedMs:
          typeof body.elapsedMs === "number" ? body.elapsedMs : undefined,
        deviceId: str("deviceId"),
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent") ?? undefined,
        // Shopify only sets this when the shopper is signed in, and it is covered by the proxy signature.
        shopifyCustomerId: url.searchParams.get("logged_in_customer_id")
          ? `gid://shopify/Customer/${url.searchParams.get("logged_in_customer_id")}`
          : undefined,
        marketingConsent: true,
        usResident: body.usResident === true,
        phone: str("phone"),
        smsConsent: body.smsConsent === true,
        utm:
          typeof body.utm === "object" && body.utm
            ? (body.utm as Record<string, string>)
            : undefined,
      });
      return result.ok
        ? json(result)
        : json({ error: result.error }, result.status);
    }
    case "customer-signup": {
      // One-tap entry for a signed-in customer: email and name come from their account.
      const customerId = customerGid(
        url.searchParams.get("logged_in_customer_id"),
      );
      const c = customerId
        ? await shopCustomer(shop, customerId).catch(() => null)
        : null;
      if (!customerId || !c?.email)
        return json(
          { error: "Please sign in again, or enter with your email." },
          400,
        );
      const result = await signup({
        shop,
        campaignSlug: params.slug!,
        email: c.email,
        name: str("name") || fullName(c),
        referralCode: str("ref"),
        deviceId: str("deviceId"),
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent") ?? undefined,
        shopifyCustomerId: customerId,
        signedInCustomer: true,
        marketingConsent: true,
        usResident: body.usResident === true,
        phone: str("phone"),
        smsConsent: body.smsConsent === true,
        utm:
          typeof body.utm === "object" && body.utm
            ? (body.utm as Record<string, string>)
            : undefined,
      });
      return result.ok
        ? json(result)
        : json({ error: result.error }, result.status);
    }
    case "verify": {
      const result = await verifyEntrant(
        shop,
        params.slug!,
        str("email") ?? "",
        str("code") ?? "",
      );
      return result.ok ? json(result) : json({ error: result.error }, 400);
    }
    case "action": {
      const result = await completeAction(
        request.headers.get("x-entrant-token") ?? "",
        str("actionId") ?? "",
        {
          code: str("code"),
          answer: str("answer"),
          step: str("step"),
          started: str("started"),
          network: str("network"),
          phone: str("phone"),
          consent: body.consent === true,
        },
      );
      return result.ok ? json(result) : json(result, 400);
    }
    case "enter-today": {
      // Daily draws: a returning entrant enters today's draw with one tap.
      const t = readEntrantToken(request.headers.get("x-entrant-token"));
      const campaign = await findLiveCampaign(shop, params.slug!);
      if (!t || !campaign || t.campaignId !== campaign.id)
        return json({ error: "Please enter your email again." }, 400);
      return json({ ok: true, awarded: await enterToday(t.entrantId) });
    }
    default:
      return json({ error: "Unknown request." }, 400);
  }
};
