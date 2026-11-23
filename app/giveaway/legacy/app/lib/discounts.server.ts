import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { sendMail } from "./mailer.server";
import { parseSettings } from "./settings";
import { DAY_MS, brandedEmail, consolationCode, escapeHtml } from "./winners";

// Consolation ("thanks for entering") codes for entrants who didn't win.
// Each admin click handles one batch so the request stays short; the code is
// deterministic per entrant and saved only after Shopify has it, so retries
// are safe. Requires the write_discounts scope.

const BATCH = 40;
// Leave headroom in the Admin API cost bucket for the merchant's other apps.
const MIN_AVAILABLE = 200;

const CREATE = `#graphql
  mutation ConsolationCode($input: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $input) {
      codeDiscountNode { id }
      userErrors { field message code }
    }
  }`;

interface CreateResult {
  data?: {
    discountCodeBasicCreate?: {
      userErrors: { message: string; code: string | null }[];
    };
  };
  extensions?: {
    cost?: {
      throttleStatus?: { currentlyAvailable: number; restoreRate: number };
    };
  };
}

/** Entrants still owed a code: ACTIVE, not a standing winner, enough entries, no code yet. */
export async function pendingConsolation(
  campaignId: string,
  minEntries: number,
) {
  const [candidates, winners, totals] = await Promise.all([
    db.entrant.findMany({
      where: { campaignId, status: "ACTIVE", discountCode: null },
      select: { id: true, email: true },
      orderBy: { createdAt: "asc" },
    }),
    db.winner.findMany({
      where: { draw: { campaignId }, forfeited: false },
      select: { entrantId: true },
    }),
    db.entryEvent.groupBy({
      by: ["entrantId"],
      where: { campaignId },
      _sum: { entries: true },
    }),
  ]);
  const won = new Set(winners.map((w) => w.entrantId));
  const total = new Map(totals.map((t) => [t.entrantId, t._sum.entries ?? 0]));
  return candidates.filter(
    (e) => !won.has(e.id) && (total.get(e.id) ?? 0) >= minEntries,
  );
}

export async function sendConsolationCodes(
  admin: AdminApiContext,
  campaignId: string,
  siteUrl: string,
) {
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: { _count: { select: { draws: true } } },
  });
  if (!campaign) return { error: "Giveaway not found." };
  if (campaign._count.draws === 0)
    return { error: "Draw the winners before sending thank-you codes." };
  const { consolation: cfg } = parseSettings(campaign.settings);
  if (!cfg.enabled)
    return {
      error: "Thank-you codes are turned off in this giveaway's settings.",
    };

  const pending = await pendingConsolation(campaignId, cfg.minEntries);
  const batch = pending.slice(0, BATCH);
  const endsAt = new Date(Date.now() + cfg.daysValid * DAY_MS);
  let sent = 0;
  const failures: string[] = [];

  for (const entrant of batch) {
    const code = consolationCode(campaignId, entrant.id);
    try {
      const res = await admin.graphql(CREATE, {
        variables: {
          input: {
            title: `${campaign.title}: thanks for entering (${code})`,
            code,
            startsAt: new Date().toISOString(),
            endsAt: endsAt.toISOString(),
            usageLimit: 1,
            appliesOncePerCustomer: true,
            context: { all: "ALL" },
            customerGets: {
              value: { percentage: cfg.percentOff / 100 },
              items: { all: true },
            },
          },
        },
      });
      const json = (await res.json()) as CreateResult;
      const errors = json.data?.discountCodeBasicCreate?.userErrors ?? [];
      // TAKEN means an earlier, interrupted run already created this code.
      const fatal = errors.filter((e) => e.code !== "TAKEN");
      if (fatal.length) throw new Error(fatal.map((e) => e.message).join("; "));

      await sendMail(
        consolationEmail(
          campaign.title,
          code,
          cfg.percentOff,
          endsAt,
          entrant.email,
          siteUrl,
        ),
      );
      await db.entrant.update({
        where: { id: entrant.id },
        data: { discountCode: code },
      });
      sent++;

      const throttle = json.extensions?.cost?.throttleStatus;
      if (throttle && throttle.currentlyAvailable < MIN_AVAILABLE) {
        const wait =
          ((MIN_AVAILABLE - throttle.currentlyAvailable) /
            throttle.restoreRate) *
          1000;
        await new Promise((r) => setTimeout(r, Math.min(wait, 5000)));
      }
    } catch (err) {
      failures.push(`${entrant.email}: ${(err as Error).message}`);
      // A scope or validation problem will fail for everyone; stop early.
      if (failures.length >= 3) break;
    }
  }

  return {
    sent,
    remaining: pending.length - sent,
    ...(failures.length ? { error: `Some codes failed. ${failures[0]}` } : {}),
  };
}

function consolationEmail(
  title: string,
  code: string,
  percentOff: number,
  endsAt: Date,
  to: string,
  siteUrl: string,
) {
  const until = endsAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const subject = `Thanks for entering ${title}: ${percentOff}% off inside`;
  const text = `Thanks for entering ${title}! You didn't win this time, but here's ${percentOff}% off your next order: ${code}\nIt's single use and valid until ${until}.\n\nShop now: ${siteUrl}`;
  const html = brandedEmail({
    heading: "Thanks for entering",
    content: `<p style="margin:0 0 14px">You didn't win <strong>${escapeHtml(title)}</strong> this time, but we've got something for you: <strong>${percentOff}% off</strong> your next order.</p>
<p style="margin:0 0 18px;text-align:center"><span style="display:inline-block;padding:12px 20px;border:2px dashed #4057f5;border-radius:10px;background:#fff8d6;font-family:Menlo,Consolas,monospace;font-size:20px;font-weight:700;letter-spacing:2px;color:#161616">${escapeHtml(code)}</span></p>
<p style="margin:0 0 14px;color:#555">Single use, valid until ${escapeHtml(until)}. Enter it at checkout.</p>`,
    button: { label: "Shop Cardbit", url: siteUrl },
  });
  return { to, subject, text, html };
}
