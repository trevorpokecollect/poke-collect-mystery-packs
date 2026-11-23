import { prizeItems } from "./bundles";
import { usAddressProblem } from "./us-only";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { Prisma } from "@prisma/client";
import db from "../db.server";
import { runDraw } from "./draw.server";
import { pendingConsolation, sendConsolationCodes } from "./discounts.server";
import { syncCampaignToKlaviyo } from "./klaviyo.server";
import { sendMail } from "./mailer.server";
import { createPrizeOrder, replacePrizeOrder } from "./prize-order.server";
import { parseSettings } from "./settings";
import { slugify } from "./slug";
import { buildWinnersFeed } from "./winners-feed";
import {
  brandedEmail,
  claimDeadline,
  claimFormSchema,
  claimState,
  escapeHtml,
  fillTemplate,
  fillTemplateHtml,
  issueClaimToken,
  paragraphs,
  publicName,
  readClaimToken,
} from "./winners";

// What happens after a draw: winner emails, prize claims, forfeits and
// redraws, plus the admin intents for the draws section of the campaign page.

function claimSecret() {
  const s = process.env.CARDBIT_GIVEAWAY_ENTRANT_TOKEN_SECRET ?? process.env.SHOPIFY_API_SECRET;
  if (!s)
    throw new Error("ENTRANT_TOKEN_SECRET (or SHOPIFY_API_SECRET) must be set");
  return s;
}

/** The store's primary storefront URL, e.g. https://cardbit.com. */
export async function storefrontUrl(admin: AdminApiContext, shop: string) {
  try {
    const res = await admin.graphql(
      `#graphql
      query PrimaryDomain { shop { primaryDomain { url } } }`,
    );
    const json = (await res.json()) as {
      data?: { shop?: { primaryDomain?: { url?: string } } };
    };
    const url = json.data?.shop?.primaryDomain?.url;
    if (url) return url.replace(/\/$/, "");
  } catch (err) {
    console.warn(
      `[winners] primary domain lookup failed: ${(err as Error).message}`,
    );
  }
  return `https://${shop}`;
}

// ── Winner email ────────────────────────────────────────────────────────────

const winnerInclude = {
  entrant: true,
  draw: { include: { campaign: true, dailyPrize: true } },
} satisfies Prisma.WinnerInclude;

export async function emailWinner(winnerId: string, siteUrl: string) {
  const winner = await db.winner.findUnique({
    where: { id: winnerId },
    include: winnerInclude,
  });
  if (!winner) throw new Error("Winner not found.");
  if (winner.forfeited) throw new Error("This winner has forfeited.");
  const campaign = winner.draw.campaign;
  const { winnerEmail: cfg } = parseSettings(campaign.settings);
  if (!cfg.enabled)
    throw new Error(
      "Winner emails are turned off in this giveaway's settings.",
    );

  const notifiedAt = new Date();
  const token = issueClaimToken(
    claimSecret(),
    winner.id,
    claimDeadline(notifiedAt, cfg.claimDays)!,
  );
  const claimUrl = `${siteUrl}/apps/packs/campaigns/claim/${token}`;
  // Daily draws give away that day's product rather than the giveaway's main prize.
  const daily = await db.dailyPrize.findUnique({
    where: { drawId: winner.drawId },
    select: { title: true },
  });
  const vars = {
    prize: daily?.title || campaign.prize || campaign.title,
    title: campaign.title,
    claim_url: claimUrl,
  };
  const link = `<a href="${escapeHtml(claimUrl)}" style="color:#4057f5;font-weight:700">${escapeHtml(claimUrl)}</a>`;
  const htmlVars = {
    prize: `<strong>${escapeHtml(vars.prize)}</strong>`,
    title: escapeHtml(vars.title),
    claim_url: link,
  };

  await sendMail({
    to: winner.entrant.email,
    subject: fillTemplate(cfg.subject, vars),
    text: `${fillTemplate(cfg.body, vars)}\n\nPlease confirm within ${cfg.claimDays} days.`,
    html: brandedEmail({
      heading: "You're a winner!",
      content:
        paragraphs(fillTemplateHtml(cfg.body, htmlVars)) +
        `<p style="margin:0;color:#555">Please confirm your details within ${cfg.claimDays} days or the prize may go to another entrant.</p>`,
      button: { label: "Claim your prize", url: claimUrl },
    }),
  });
  await db.winner.update({ where: { id: winner.id }, data: { notifiedAt } });
}

/** Emails every winner of a draw who hasn't been emailed yet. */
export async function emailDrawWinners(drawId: string, siteUrl: string) {
  const winners = await db.winner.findMany({
    where: { drawId, forfeited: false, notifiedAt: null },
    select: { id: true },
  });
  let sent = 0;
  for (const w of winners) {
    await emailWinner(w.id, siteUrl);
    sent++;
  }
  return sent;
}

// ── Forfeit and redraw ──────────────────────────────────────────────────────

/**
 * Marks an unclaimed winner forfeited and draws one replacement, excluding
 * everyone who has ever won this campaign (daily prizes: see redrawDailyWinner). The guarded update makes a double
 * click a no-op instead of a second redraw.
 */
export async function forfeitAndRedraw(campaignId: string, winnerId: string) {
  const { count } = await db.winner.updateMany({
    where: {
      id: winnerId,
      draw: { campaignId },
      forfeited: false,
      claimedAt: null,
    },
    data: { forfeited: true },
  });
  if (count === 0) throw new Error("This winner can't be forfeited.");
  try {
    // A daily winner is replaced from that day's entries, in the same draw.
    const daily = await db.dailyPrize.findFirst({
      where: { draw: { winners: { some: { id: winnerId } } } },
    });
    if (daily?.drawId) {
      // Imported here: daily.server imports this module.
      const { redrawDailyWinner } = await import("./daily.server");
      await redrawDailyWinner({ ...daily, drawId: daily.drawId });
      return await db.draw.findUniqueOrThrow({
        where: { id: daily.drawId },
        include: { winners: { include: { entrant: true } } },
      });
    }
    return await runDraw(campaignId, 1, `redraw:${winnerId}`, {
      excludeForfeited: true,
    });
  } catch (err) {
    throw new Error(
      `Winner forfeited, but no replacement: ${(err as Error).message}`,
    );
  }
}

// ── Prize claim (storefront, through the app proxy) ─────────────────────────

export type ClaimView =
  | { kind: "invalid" }
  | { kind: "closed"; title: string }
  | { kind: "claimed"; title: string; prize: string }
  | {
      kind: "form";
      title: string;
      prize: string;
      imageUrl: string | null;
      /** Bundle prizes: every product's picture and count. */
      items?:
        { imageUrl: string | null; quantity: number; title: string }[] | null;
      deadline: Date;
      defaults: { name: string };
    };

async function claimWinner(token: string | undefined) {
  const parsed = readClaimToken(claimSecret(), token);
  if (!parsed) return null;
  const winner = await db.winner.findUnique({
    where: { id: parsed.winnerId },
    include: winnerInclude,
  });
  return winner ? { winner, parsed } : null;
}

export async function loadClaim(
  shop: string,
  token: string | undefined,
): Promise<ClaimView> {
  const found = await claimWinner(token);
  // The token is shop-agnostic, so also check it belongs to this storefront.
  if (!found || found.winner.draw.campaign.shop !== shop)
    return { kind: "invalid" };
  const { winner, parsed } = found;
  const campaign = winner.draw.campaign;
  // Daily winners won that day's product, not the giveaway's main prize.
  const daily = winner.draw.dailyPrize;
  const prize = daily?.title || campaign.prize || campaign.title;
  if (winner.claimedAt)
    return { kind: "claimed", title: campaign.title, prize };
  if (winner.forfeited || parsed.expired)
    return { kind: "closed", title: campaign.title };
  return {
    kind: "form",
    title: campaign.title,
    prize,
    imageUrl: daily ? daily.imageUrl : campaign.imageUrl,
    items: daily ? prizeItems(daily.items) : null,
    deadline: parsed.expiresAt,
    defaults: { name: winner.entrant.name ?? "" },
  };
}

export async function submitClaim(
  shop: string,
  token: string | undefined,
  form: Record<string, string>,
) {
  const view = await loadClaim(shop, token);
  if (view.kind !== "form") return { view };
  const parsed = claimFormSchema.safeParse(form);
  if (!parsed.success)
    return {
      view,
      error:
        parsed.error.issues.find((i) => i.path[0] === "phone")?.message ??
        "Please fill in every required field.",
    };
  const { winnerId } = readClaimToken(claimSecret(), token)!;
  const settings = await db.winner.findUnique({
    where: { id: winnerId },
    select: { draw: { select: { campaign: { select: { settings: true } } } } },
  });
  if (parseSettings(settings?.draw.campaign.settings).usOnly) {
    const problem = usAddressProblem(parsed.data);
    if (problem) return { view, error: problem };
  }
  // Only the first submission counts.
  const first = await db.winner.updateMany({
    where: { id: winnerId, claimedAt: null, forfeited: false },
    data: { claimData: parsed.data, claimedAt: new Date() },
  });
  // Daily prizes get a $0 order to ship from. A failure doesn't stop the claim; the
  // admin can retry with Create Order.
  if (first.count === 1)
    await createPrizeOrder(winnerId).catch((err) =>
      console.error(`[claim] prize order failed {winner: ${winnerId}}`, err),
    );
  return { view: await loadClaim(shop, token) };
}

// ── Public winners list (storefront JSON) ───────────────────────────────────

/**
 * Winners of an ended giveaway as "First L." names, or null when the giveaway
 * isn't ended or has showWinners off. Accepts the same link forms as findLiveCampaign.
 */
export async function publicWinners(shop: string, slug: string) {
  const now = new Date();
  const ended: Prisma.CampaignWhereInput = {
    shop,
    OR: [{ status: "ENDED" }, { status: "ACTIVE", endsAt: { lt: now } }],
  };
  const wanted = slugify(slug);
  const campaign =
    wanted && wanted !== "latest"
      ? ((await db.campaign.findFirst({ where: { ...ended, slug: wanted } })) ??
        (await db.campaign.findFirst({
          where: {
            ...ended,
            title: { equals: slug.trim(), mode: "insensitive" },
          },
          orderBy: { createdAt: "desc" },
        })))
      : await db.campaign.findFirst({
          where: ended,
          orderBy: [
            { endsAt: { sort: "desc", nulls: "last" } },
            { updatedAt: "desc" },
          ],
        });
  if (!campaign || !parseSettings(campaign.settings).showWinners) return null;
  const winners = await db.winner.findMany({
    where: { draw: { campaignId: campaign.id }, forfeited: false },
    orderBy: { position: "asc" },
    include: { entrant: { select: { name: true, email: true } } },
  });
  return winners.map((w) => ({
    position: w.position,
    name: publicName(w.entrant.name, w.entrant.email),
  }));
}

/**
 * Every Daily and Monthly winner in the shop, newest first, for the storefront winners
 * page. Skips draft/archived giveaways and any with "Show winners" turned off.
 */
export async function winnersFeed(shop: string) {
  const draws = await db.draw.findMany({
    where: {
      campaign: { shop, status: { in: ["ACTIVE", "ENDED", "SCHEDULED"] } },
    },
    orderBy: { createdAt: "desc" },
    take: 400,
    select: {
      createdAt: true,
      campaign: {
        select: {
          slug: true,
          title: true,
          prize: true,
          imageUrl: true,
          settings: true,
        },
      },
      dailyPrize: {
        select: {
          periodKey: true,
          title: true,
          imageUrl: true,
          productHandle: true,
        },
      },
      winners: {
        select: {
          position: true,
          forfeited: true,
          entrant: { select: { name: true, email: true, status: true } },
        },
      },
    },
  });
  return buildWinnersFeed(
    draws.filter((d) => parseSettings(d.campaign.settings).showWinners),
  );
}

// ── Admin: draws section intents ────────────────────────────────────────────

export const DRAW_INTENTS = new Set([
  "emailWinner",
  "emailDraw",
  "forfeitRedraw",
  "consolation",
  "klaviyoSync",
  "prizeOrder",
  "redoPrizeOrder",
]);

/** Handles the draws-section buttons on app.campaigns.$id. */
export async function handleDrawIntent(opts: {
  admin: AdminApiContext;
  shop: string;
  campaignId: string;
  intent: string;
  form: FormData;
}): Promise<{ ok?: true; error?: string; message?: string; drawId?: string }> {
  const { admin, shop, campaignId, intent, form } = opts;
  const audit = (action: string, data?: object) =>
    db.auditLog.create({ data: { shop, action, target: campaignId, data } });
  const winnerId = String(form.get("winnerId") ?? "");
  const ownWinner = () =>
    db.winner.findFirst({ where: { id: winnerId, draw: { campaignId } } });

  try {
    switch (intent) {
      case "emailWinner": {
        if (!(await ownWinner())) return { error: "Winner not found." };
        await emailWinner(winnerId, await storefrontUrl(admin, shop));
        await audit("winner.email", { winnerId });
        return { ok: true, message: "Winner emailed." };
      }
      case "emailDraw": {
        const drawId = String(form.get("drawId") ?? "");
        const draw = await db.draw.findFirst({
          where: { id: drawId, campaignId },
        });
        if (!draw) return { error: "Draw not found." };
        const sent = await emailDrawWinners(
          drawId,
          await storefrontUrl(admin, shop),
        );
        await audit("winner.email_all", { drawId, sent });
        return {
          ok: true,
          message: sent
            ? `Emailed ${sent} winner(s).`
            : "Every winner was already emailed.",
        };
      }
      case "forfeitRedraw": {
        if (!(await ownWinner())) return { error: "Winner not found." };
        const draw = await forfeitAndRedraw(campaignId, winnerId);
        await audit("winner.forfeit_redraw", { winnerId, drawId: draw.id });
        return { ok: true, drawId: draw.id };
      }
      case "consolation": {
        const r = await sendConsolationCodes(
          admin,
          campaignId,
          await storefrontUrl(admin, shop),
        );
        if ("sent" in r) await audit("consolation.send", { sent: r.sent });
        return {
          ...(r.error ? { error: r.error } : { ok: true as const }),
          ...("sent" in r
            ? {
                message: `Sent ${r.sent} code(s).${r.remaining ? ` ${r.remaining} left; click again to continue.` : ""}`,
              }
            : {}),
        };
      }
      case "prizeOrder": {
        if (!(await ownWinner())) return { error: "Winner not found." };
        const name = await createPrizeOrder(winnerId, admin);
        if (!name)
          return { error: "Only a claimed daily prize can get an order." };
        await audit("winner.prize_order", { winnerId, order: name });
        return { ok: true, message: `Order ${name} created.` };
      }
      case "redoPrizeOrder": {
        if (!(await ownWinner())) return { error: "Winner not found." };
        const name = await replacePrizeOrder(winnerId, admin);
        if (!name)
          return { error: "Only a claimed daily prize can get an order." };
        await audit("winner.prize_order_redo", { winnerId, order: name });
        return {
          ok: true,
          message: `Order ${name} created; the old order was cancelled.`,
        };
      }
      case "klaviyoSync": {
        const r = await syncCampaignToKlaviyo(campaignId);
        if ("error" in r) return { error: r.error };
        await audit("klaviyo.sync_all", { queued: r.queued });
        return {
          ok: true,
          message: `Syncing ${r.queued} entrant(s) to Klaviyo in the background.`,
        };
      }
    }
  } catch (err) {
    return { error: (err as Error).message };
  }
  return { error: "Unknown request." };
}

/** Claim status per winner for the admin, from loader data. */
export function winnerStatus(
  w: { claimedAt: Date | null; forfeited: boolean; notifiedAt: Date | null },
  settings: unknown,
) {
  const { claimDays } = parseSettings(settings).winnerEmail;
  const deadline = claimDeadline(w.notifiedAt, claimDays);
  return {
    state: claimState(w, claimDays),
    deadline: deadline?.toISOString() ?? null,
  };
}

/** Extra loader data for the draws section: integration toggles, counts and reveal names. */
export async function drawsSectionExtras(campaign: {
  id: string;
  settings: unknown;
}) {
  const settings = parseSettings(campaign.settings);
  const [pending, codesSent, synced, sample] = await Promise.all([
    settings.consolation.enabled
      ? pendingConsolation(campaign.id, settings.consolation.minEntries)
      : [],
    db.entrant.count({
      where: { campaignId: campaign.id, discountCode: { not: null } },
    }),
    db.entrant.count({
      where: { campaignId: campaign.id, klaviyoSyncedAt: { not: null } },
    }),
    db.entrant.findMany({
      where: { campaignId: campaign.id, status: "ACTIVE" },
      select: { name: true, email: true },
      take: 60,
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  return {
    winnerEmailEnabled: settings.winnerEmail.enabled,
    consolation: settings.consolation.enabled
      ? {
          pending: pending.length,
          sent: codesSent,
          percentOff: settings.consolation.percentOff,
        }
      : null,
    klaviyo: settings.klaviyo.enabled ? { synced } : null,
    revealNames: sample.map((e) => e.name || e.email.split("@")[0]),
  };
}
