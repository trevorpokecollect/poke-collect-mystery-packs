import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useState } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { CampaignStatus, EntrantStatus } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { runDraw } from "../lib/draw.server";
import { activate, clawBackReferrals } from "../lib/entries/signup.server";
import { riskTone, statusTone } from "../lib/ui";
import { downloadFile } from "../lib/download";
import {
  DRAW_INTENTS,
  drawsSectionExtras,
  handleDrawIntent,
  winnerStatus,
} from "../lib/winners.server";
import { DrawsSection } from "../components/DrawsSection";
import { DailySection, type DailyData } from "../components/DailySection";
import {
  currentPrize,
  dailySettings,
  drawPrize,
  ensurePrize,
  markPrizeSent,
  releasePrize,
  swapPrize,
  choosePrize,
} from "../lib/daily.server";
import { publicName } from "../lib/winners";
import {
  orderPlacedAt,
  ordersCountFrom,
  removePreStartOrderEntries,
} from "../lib/entries/orders.server";
import { methodWindow } from "../lib/method-window";
import {
  disqualifyDomain,
  restoreDomain,
  suspiciousDomains,
} from "../lib/entries/domain-tools.server";
import { entriesByMethod } from "../lib/entries/methods.server";
import { checkListStatus, listGrowth } from "../lib/entries/list-status.server";
import { parseBundle } from "../lib/bundles";
import {
  addBundleToQueue,
  addToQueue,
  moveQueueItem,
  pinQueueItem,
  removeQueueItem,
  upcomingPlan,
} from "../lib/daily-queue.server";

type GrowthData = Awaited<ReturnType<typeof listGrowth>>;
import { EntriesByMethodTable } from "../components/EntriesByMethod";
import { EntryActivityTable } from "../components/EntryActivity";
import { flag, Select } from "../components/fields";
import { AddEntriesForm } from "../components/AddEntries";
import { SearchBox } from "../components/SearchBox";
import { entrantSearchWhere } from "../lib/entries/search";
import { addEntries } from "../lib/entries/adjust.server";
import {
  activityFeed,
  restoreEvent,
  voidEvent,
} from "../lib/entries/void.server";

const FILTERS = [
  "ALL",
  "ACTIVE",
  "HELD",
  "PENDING_VERIFICATION",
  "DISQUALIFIED",
] as const;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const campaign = await db.campaign.findFirst({
    where: { id: params.id, shop: session.shop },
    include: { actions: { orderBy: { sortOrder: "asc" } } },
  });
  if (!campaign) throw new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const filter = url.searchParams.get("status") ?? "ALL";
  // Entrant search: every word in the email or name (app/lib/entries/search.ts).
  const q = url.searchParams.get("q")?.trim().slice(0, 200) ?? "";
  const searchWhere = entrantSearchWhere(q) ?? {};
  const statusWhere =
    filter !== "ALL" && FILTERS.includes(filter as never)
      ? { status: filter as EntrantStatus }
      : {};

  const [counts, entrants, totals, orders, draws] = await Promise.all([
    db.entrant.groupBy({
      by: ["status"],
      where: { campaignId: campaign.id },
      _count: true,
    }),
    db.entrant.findMany({
      where: { campaignId: campaign.id, ...statusWhere, ...searchWhere },
      orderBy: [{ riskScore: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: { riskSignals: { select: { code: true } } },
    }),
    db.entryEvent.groupBy({
      by: ["entrantId"],
      where: { campaignId: campaign.id },
      _sum: { entries: true },
    }),
    db.orderLog.findMany({
      where: { campaignId: campaign.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.draw.findMany({
      where: { campaignId: campaign.id },
      orderBy: { createdAt: "desc" },
      include: {
        winners: {
          orderBy: { position: "asc" },
          include: { entrant: { select: { email: true, name: true } } },
        },
        dailyPrize: { select: { id: true } },
      },
    }),
  ]);
  const dailyCfg = dailySettings(campaign);
  // Daily giveaways show the current draw by default, or one past draw, or all time.
  const pastDraws: { key: string; title: string }[] = [];
  if (dailyCfg.enabled)
    for (const p of await db.dailyPrize.findMany({
      where: {
        campaignId: campaign.id,
        drawId: { not: null },
        drawAt: { lte: new Date() },
      },
      orderBy: [{ drawAt: "desc" }, { createdAt: "desc" }],
      take: 120,
      select: { periodKey: true, title: true },
    }))
      if (!pastDraws.some((d) => d.key === p.periodKey))
        pastDraws.push({ key: p.periodKey, title: p.title });
  const methodWin = methodWindow({
    daily: dailyCfg.enabled,
    methods: url.searchParams.get("methods"),
    draw: url.searchParams.get("draw"),
    pastDraws: pastDraws.map((d) => d.key),
    now: new Date(),
    timeZone: campaign.timezone,
    drawTime: dailyCfg.drawTime,
  });
  // Looks up new sign-ups in Shopify in the background; counts fill in on later visits.
  void checkListStatus(campaign);
  const [methods, growth] = await Promise.all([
    entriesByMethod(campaign.id, {
      since: methodWin.since,
      until: methodWin.until,
    }),
    listGrowth(campaign.id, methodWin.since, methodWin.until),
  ]);
  let daily: DailyData | null = null;
  if (dailyCfg.enabled) {
    const [current, prizes, upcoming] = await Promise.all([
      currentPrize(campaign),
      db.dailyPrize.findMany({
        where: { campaignId: campaign.id },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: {
          draw: {
            include: {
              winners: {
                take: 1,
                include: { entrant: { select: { name: true, email: true } } },
              },
            },
          },
        },
      }),
      upcomingPlan(campaign, 7),
    ]);
    const plannedFor = new Map(
      upcoming.plan.flatMap((d) => (d.item ? [[d.item.id, d.date]] : [])),
    );
    daily = {
      queue: upcoming.items.map((q) => ({
        id: q.id,
        title: q.title,
        imageUrl: q.imageUrl,
        pinnedDate: q.pinnedDate,
        note: q.note,
        plannedFor: plannedFor.get(q.id) ?? null,
        bundle: Array.isArray(q.bundle),
        images: Array.isArray(q.bundle)
          ? (q.bundle as { imageUrl: string | null }[])
              .map((b) => b.imageUrl)
              .filter((u): u is string => !!u)
          : [],
      })),
      drawTime: dailyCfg.drawTime,
      timezone: campaign.timezone,
      currentId: current?.prize?.id ?? null,
      prizes: prizes.map((p) => {
        const w = p.draw?.winners[0];
        return {
          id: p.id,
          periodKey: p.periodKey,
          title: p.title,
          imageUrl: p.imageUrl,
          value: p.value,
          status: p.status,
          drawAt: p.drawAt.toISOString(),
          winner: w
            ? `${publicName(w.entrant.name, w.entrant.email)} (${w.entrant.email})`
            : null,
          note: p.note,
          fromSafetyStock: p.reservedFrom === "safety_stock",
        };
      }),
    };
  }
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: campaign.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  const activityMethod = url.searchParams.get("activity") ?? "";
  const activityQ = url.searchParams.get("aq")?.trim().slice(0, 200) ?? "";
  const activity = await activityFeed(campaign.id, {
    method: activityMethod || undefined,
    q: activityQ,
  });
  const totalBy = Object.fromEntries(
    totals.map((t) => [t.entrantId, t._sum.entries ?? 0]),
  );

  return {
    filter,
    q,
    storefrontPath: `/apps/packs/campaigns/${campaign.slug}`,
    startsLabel: when.format(ordersCountFrom(campaign)),
    campaign: {
      id: campaign.id,
      title: campaign.title,
      status: campaign.status,
      slug: campaign.slug,
      actions: campaign.actions.map((a) => ({
        id: a.id,
        label: a.label,
        entries: a.entries,
        type: a.type,
      })),
    },
    counts: Object.fromEntries(
      counts.map((c) => [c.status, c._count]),
    ) as Record<string, number>,
    totalEntries: totals.reduce(
      (s, t) => s + Math.max(0, t._sum.entries ?? 0),
      0,
    ),
    entrants: entrants.map((e) => ({
      id: e.id,
      email: e.email,
      name: e.name,
      status: e.status,
      riskScore: e.riskScore,
      signals: [...new Set(e.riskSignals.map((s) => s.code))],
      entries: Math.max(0, totalBy[e.id] ?? 0),
      createdAt: e.createdAt.toISOString(),
    })),
    orders: orders.map((o) => ({
      id: o.id,
      name: o.orderName,
      email: o.email,
      status:
        (o.breakdown as { reason?: string } | null)?.reason ===
        "placed before the giveaway started"
          ? "placed before start, entries removed"
          : o.status.toLowerCase().replaceAll("_", " "),
      entries: o.entries,
      placed: (() => {
        const at = orderPlacedAt(o.breakdown);
        return at ? when.format(at) : null;
      })(),
    })),
    draws: draws.map((d) => ({
      id: d.id,
      createdAt: d.createdAt.toISOString(),
      seed: d.seed,
      snapshotHash: d.snapshotHash,
      totalEntries: d.totalEntries,
      eligibleCount: d.eligibleCount,
      winners: d.winners.map((w) => ({
        id: w.id,
        position: w.position,
        email: w.entrant.email,
        name: w.entrant.name,
        notifiedAt: w.notifiedAt?.toISOString() ?? null,
        claimedAt: w.claimedAt?.toISOString() ?? null,
        forfeited: w.forfeited,
        claimData: w.claimData as Record<string, string> | null,
        // Daily product prizes get a $0 Shopify order when claimed.
        prizeOrder: d.dailyPrize
          ? {
              name: w.prizeOrderName,
              id: w.prizeOrderId?.split("/").pop() ?? null,
            }
          : null,
        ...winnerStatus(w, campaign.settings),
      })),
    })),
    drawExtras: await drawsSectionExtras(campaign),
    // Uncommon email domains with many entrants (bot farms), for the Entrants tab.
    domains: await suspiciousDomains(campaign.id),
    daily,
    methods: {
      period: methodWin.period,
      draw: methodWin.draw,
      draws: pastDraws,
      rows: methods.rows,
    },
    growth,
    activity: {
      method: activityMethod,
      q: activityQ,
      items: activity.map((a) => ({ ...a, at: when.format(a.at) })),
    },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const campaign = await db.campaign.findFirst({
    where: { id: params.id, shop: session.shop },
  });
  if (!campaign) throw new Response("Not found", { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const entrantIds = form.getAll("entrantId").map(String);
  const audit = (action: string, data?: object) =>
    db.auditLog.create({
      data: { shop: session.shop, action, target: campaign.id, data },
    });

  if (DRAW_INTENTS.has(intent))
    return handleDrawIntent({
      admin,
      shop: session.shop,
      campaignId: campaign.id,
      intent,
      form,
    });

  if (intent.startsWith("daily")) {
    const prizeId = String(form.get("prizeId") ?? "");
    const owned = async () => {
      const p = await db.dailyPrize.findFirst({
        where: { id: prizeId, campaignId: campaign.id },
      });
      if (!p) throw new Error("Prize not found.");
      return p;
    };
    try {
      const itemId = String(form.get("itemId") ?? "");
      switch (intent) {
        case "dailyQueueAdd": {
          const raw = JSON.parse(String(form.get("products") ?? "[]")) as {
            productId?: unknown;
            title?: unknown;
            imageUrl?: unknown;
          }[];
          const products = raw
            .filter(
              (p) =>
                typeof p.productId === "string" &&
                p.productId.startsWith("gid://shopify/Product/"),
            )
            .slice(0, 100)
            .map((p) => ({
              productId: p.productId as string,
              title: String(p.title ?? "").slice(0, 200) || "Product",
              imageUrl: typeof p.imageUrl === "string" ? p.imageUrl : null,
            }));
          if (!products.length) return { error: "Choose a product." };
          await addToQueue(campaign.id, products);
          await audit("daily.queueAdd", { count: products.length });
          return { ok: true };
        }
        case "dailyQueueBundle": {
          const parts = parseBundle(
            JSON.parse(String(form.get("parts") ?? "[]")),
          );
          if (!parts)
            return {
              error:
                "A bundle needs 2 or more items in all (up to 6 products, 10 of each).",
            };
          await addBundleToQueue(campaign.id, parts);
          await audit("daily.queueBundle", { parts: parts.length });
          return { ok: true };
        }
        case "dailyQueueMove": {
          await moveQueueItem(
            campaign.id,
            itemId,
            form.get("dir") === "up" ? "up" : "down",
          );
          return { ok: true };
        }
        case "dailyQueueRemove": {
          await removeQueueItem(campaign.id, itemId);
          return { ok: true };
        }
        case "dailyQueuePin": {
          await pinQueueItem(
            campaign.id,
            itemId,
            String(form.get("date") ?? "") || null,
          );
          return { ok: true };
        }
        case "dailyPick": {
          const p = await ensurePrize(campaign, admin);
          if (!p)
            return {
              error:
                "No prize picked. Check that daily draw is on, the giveaway is live, and an in-stock product matches the rules.",
            };
          await audit("daily.pick", { prizeId: p.id });
          return { ok: true, message: `Today's prize: ${p.title}` };
        }
        case "dailyChoose": {
          const productId = String(form.get("productId") ?? "");
          if (!productId.startsWith("gid://shopify/Product/"))
            return { error: "Choose a product." };
          const p = await choosePrize(campaign, admin, productId);
          await audit("daily.choose", { prizeId: p.id });
          return { ok: true, message: `Today's prize: ${p.title}` };
        }
        case "dailySwap": {
          const p = await swapPrize(campaign, admin);
          await audit("daily.swap", { prizeId: p.id });
          return { ok: true, message: `Swapped. Today's prize: ${p.title}` };
        }
        case "dailyDrawNow": {
          const p = (await currentPrize(campaign))?.prize;
          if (!p || p.status !== "RESERVED")
            return { error: "There's no reserved prize to draw." };
          const draw = await drawPrize(p, admin);
          await audit("daily.draw", { prizeId: p.id, drawId: draw?.id });
          return draw
            ? { ok: true, message: "Winner drawn and emailed." }
            : {
                ok: true,
                message:
                  "Nobody has entered today, so the prize went back to stock.",
              };
        }
        case "dailySent": {
          await markPrizeSent((await owned()).id, admin);
          await audit("daily.sent", { prizeId });
          return {
            ok: true,
            message: "Marked sent and removed from inventory.",
          };
        }
        case "dailyRelease": {
          await releasePrize(
            (await owned()).id,
            admin,
            "Released from the admin",
          );
          await audit("daily.release", { prizeId });
          return { ok: true, message: "Prize put back in stock." };
        }
      }
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  switch (intent) {
    case "status": {
      const status = String(form.get("status")) as CampaignStatus;
      // Going live with no start date records one, so only orders placed from now earn entries.
      const startsAt =
        status === "ACTIVE" && !campaign.startsAt ? new Date() : undefined;
      await db.campaign.update({
        where: { id: campaign.id },
        data: { status, startsAt },
      });
      await audit("campaign.status", { status, startsAt });
      break;
    }
    case "voidEvent":
    case "restoreEvent": {
      const eventId = String(form.get("eventId") ?? "");
      const r =
        intent === "voidEvent"
          ? await voidEvent(
              campaign.id,
              eventId,
              String(form.get("reason") ?? ""),
            )
          : await restoreEvent(campaign.id, eventId);
      if ("ok" in r) await audit(`entry.${intent}`, { eventId });
      return r;
    }
    case "removePreStart": {
      const r = await removePreStartOrderEntries(campaign, admin);
      await audit("orders.removePreStart", r);
      return {
        ok: true,
        message: r.orders
          ? `Removed ${r.entries.toLocaleString()} entries from ${r.orders} orders placed before the giveaway started.`
          : "No entries from orders placed before the giveaway started.",
      };
    }
    case "approve": {
      for (const id of entrantIds) {
        const e = await db.entrant.findFirst({
          where: { id, campaignId: campaign.id },
        });
        if (e && e.status !== "ACTIVE") await activate(id);
      }
      await audit("entrant.approve", { entrantIds });
      break;
    }
    case "disqualify": {
      await db.entrant.updateMany({
        where: { id: { in: entrantIds }, campaignId: campaign.id },
        data: { status: "DISQUALIFIED" },
      });
      for (const id of entrantIds) await clawBackReferrals(id);
      await audit("entrant.disqualify", { entrantIds });
      break;
    }
    case "addEntries": {
      const r = await addEntries({
        campaignId: campaign.id,
        email: String(form.get("email") ?? ""),
        entries: form.get("entries"),
        note: String(form.get("note") ?? ""),
      });
      if ("error" in r) return r;
      await audit("entry.add", { entrantId: r.entrantId, entries: r.entries });
      return {
        ok: true,
        message: `${r.entries > 0 ? "Added" : "Took away"} ${Math.abs(r.entries).toLocaleString()} entries for ${r.label}. They now have ${r.total.toLocaleString()}.`,
      };
    }
    case "disqualifyDomain": {
      const domain = String(form.get("domain") ?? "");
      const ids = await disqualifyDomain(campaign.id, domain);
      await audit("entrant.disqualifyDomain", { domain, count: ids.length });
      // Referral entries they gave out are taken back in the background (can be thousands).
      void (async () => {
        for (const id of ids)
          await clawBackReferrals(id).catch((err) =>
            console.warn(`[domains] clawback ${id}: ${(err as Error).message}`),
          );
      })();
      return {
        ok: true,
        message: `Disqualified ${ids.length.toLocaleString()} entrants on ${domain}.`,
      };
    }
    case "restoreDomain": {
      const domain = String(form.get("domain") ?? "");
      const n = await restoreDomain(campaign.id, domain);
      await audit("entrant.restoreDomain", { domain, count: n });
      return {
        ok: true,
        message: `Restored ${n.toLocaleString()} entrants on ${domain}.`,
      };
    }
    case "draw": {
      const count = Math.max(1, Math.min(50, Number(form.get("count") || 1)));
      try {
        const draw = await runDraw(campaign.id, count);
        await audit("draw.run", { drawId: draw.id });
        return { ok: true, drawId: draw.id };
      } catch (err) {
        return { error: (err as Error).message };
      }
    }
  }
  return { ok: true };
};

const TABS = [
  ["overview", "Overview"],
  ["entrants", "Entrants"],
  ["activity", "Activity"],
  ["orders", "Orders"],
  ["draws", "Draws"],
] as const;
type Tab = (typeof TABS)[number][0];

// "Mon, Oct 19" for a draw key (YYYY-MM-DD).
const shortDay = (ymd: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${ymd}T12:00:00Z`));

export default function CampaignPage() {
  const {
    campaign,
    counts,
    totalEntries,
    entrants,
    orders,
    draws,
    drawExtras,
    daily,
    filter,
    q,
    storefrontPath,
    methods,
    startsLabel,
    activity,
    growth,
    domains,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const submit = (data: Record<string, string>) =>
    fetcher.submit(data, { method: "post" });
  const [search, setSearch] = useSearchParams();
  const [showAdd, setShowAdd] = useState(false);
  const tab = (TABS.find(([t]) => t === search.get("tab"))?.[0] ??
    "overview") as Tab;
  // Changes some query params and keeps the rest (tab, filters, searches).
  const setParams = (changes: Record<string, string | null>) =>
    setSearch((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes))
        if (v) next.set(k, v);
        else next.delete(k);
      return next;
    });
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const busy = fetcher.state !== "idle";
  const base = `/staff/cardbit-campaigns/campaigns/${campaign.id}`;

  const methodSwitch = daily && (
    <s-stack gap="small-200">
      <s-stack direction="inline" gap="small-200">
        {(
          [
            ["today", "Current Draw"],
            ["draw", "Past Draws"],
            ["all", "All Time"],
          ] as const
        )
          .filter(([value]) => value !== "draw" || methods.draws.length)
          .map(([value, label]) => (
            <s-button
              key={value}
              variant={methods.period === value ? "primary" : "secondary"}
              onClick={() =>
                setParams({
                  methods: value === "today" ? null : value,
                  draw: null,
                })
              }
            >
              {label}
            </s-button>
          ))}
      </s-stack>
      {methods.period === "draw" && (
        <Select
          label="Draw"
          value={methods.draw ?? ""}
          options={methods.draws.map((d) => ({
            value: d.key,
            label: `${shortDay(d.key)} · ${d.title}`,
          }))}
          onChange={(v) => setParams({ methods: "draw", draw: v })}
        />
      )}
    </s-stack>
  );

  return (
    <s-page heading={campaign.title} inlineSize="large">
      <s-badge slot="title-metadata" tone={statusTone(campaign.status)}>
        {campaign.status.toLowerCase()}
      </s-badge>
      {campaign.status === "ACTIVE" ? (
        <s-button
          slot="primary-action"
          onClick={() => submit({ intent: "status", status: "ENDED" })}
        >
          End Giveaway
        </s-button>
      ) : (
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={() => submit({ intent: "status", status: "ACTIVE" })}
        >
          Go Live
        </s-button>
      )}
      <s-button slot="secondary-actions" href={`${base}/edit`}>
        Edit
      </s-button>
      <s-button slot="secondary-actions" href={`${base}/analytics`}>
        Analytics
      </s-button>
      <s-button
        slot="secondary-actions"
        onClick={() =>
          downloadFile(
            `${base}/export${filter === "ALL" ? "" : `?status=${filter}`}`,
            "entrants.csv",
          )
        }
      >
        Export CSV
      </s-button>
      <s-button slot="secondary-actions" href={`${base}/import`}>
        Import
      </s-button>
      <s-button
        slot="secondary-actions"
        onClick={() =>
          fetcher.submit(
            { intent: "duplicate" },
            { method: "post", action: `${base}/edit` },
          )
        }
      >
        Duplicate
      </s-button>

      <s-section padding="base">
        <s-stack gap="base">
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(150px, 1fr))"
            gap="base"
          >
            <Stat label="Entrants" value={total} />
            <Stat label="Entries" value={totalEntries} />
            <Stat label="Needs Review" value={counts.HELD ?? 0} />
            <Stat label="Disqualified" value={counts.DISQUALIFIED ?? 0} />
          </s-grid>
          <s-stack direction="inline" gap="small-200">
            {TABS.map(([t, label]) => (
              <s-button
                key={t}
                variant={t === tab ? "primary" : "secondary"}
                onClick={() => setParams({ tab: t === "overview" ? null : t })}
              >
                {label}
              </s-button>
            ))}
          </s-stack>
        </s-stack>
      </s-section>

      {fetcher.data && "error" in fetcher.data && (
        <s-banner tone="critical">{String(fetcher.data.error)}</s-banner>
      )}
      {fetcher.data &&
        "message" in fetcher.data &&
        fetcher.state === "idle" && (
          <s-banner tone="success">{String(fetcher.data.message)}</s-banner>
        )}

      {tab === "overview" && (
        <>
          {daily && <DailySection daily={daily} />}
          <s-section heading="Entries By Method">
            <s-stack gap="base">
              {methodSwitch}
              <EntriesByMethodTable rows={methods.rows} />
            </s-stack>
          </s-section>
          <s-section heading="New Sign-Ups">
            <NewSignups growth={growth} />
          </s-section>
          <s-section heading="Latest Entries">
            <s-stack gap="base">
              <EntryActivityTable
                items={activity.items.slice(0, 8)}
                campaignId={campaign.id}
                submit={submit}
                busy={busy}
                compact
              />
              <s-button
                variant="tertiary"
                onClick={() => setParams({ tab: "activity" })}
              >
                See All Activity
              </s-button>
            </s-stack>
          </s-section>
        </>
      )}

      {tab === "activity" && (
        <s-section heading="Activity">
          <s-stack gap="base">
            <s-grid
              gridTemplateColumns="minmax(180px, 260px) minmax(200px, 1fr)"
              gap="base"
              alignItems="end"
            >
              <Select
                label="Method"
                value={activity.method}
                options={[
                  { value: "", label: "All methods" },
                  ...methods.rows.map((r) => ({
                    value: r.key,
                    label: r.label,
                  })),
                ]}
                onChange={(v) => setParams({ activity: v || null })}
              />
              <SearchBox
                label="Search"
                placeholder="Search by name or email"
                value={activity.q}
                onSearch={(v) => setParams({ aq: v || null })}
              />
            </s-grid>
            <EntryActivityTable
              items={activity.items}
              campaignId={campaign.id}
              submit={submit}
              busy={busy}
            />
            <s-text color="subdued">
              Newest 100 entries. Disqualify takes back just that entry; Restore
              gives it back.
            </s-text>
          </s-stack>
        </s-section>
      )}

      {tab === "entrants" && (
        <s-section heading="Entrants">
          <s-stack gap="base">
            <s-stack direction="inline">
              <s-button onClick={() => setShowAdd(!showAdd)}>
                {showAdd ? "Close" : "Add Entries"}
              </s-button>
            </s-stack>
            {showAdd && (
              <s-box padding="base" border="base" borderRadius="base">
                <AddEntriesForm
                  submit={submit}
                  busy={fetcher.state !== "idle"}
                  askEmail
                />
              </s-box>
            )}
            <SearchBox
              label="Search entrants"
              placeholder="Search by name or email, like Ash Ketchum or ash@gmail.com"
              value={q}
              onSearch={(v) => setParams({ q: v || null })}
            />
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-stack direction="inline" gap="small-200">
                {FILTERS.map((f) => (
                  <s-button
                    key={f}
                    variant={f === filter ? "primary" : "secondary"}
                    onClick={() =>
                      setParams({ status: f === "ALL" ? null : f })
                    }
                  >
                    {f === "PENDING_VERIFICATION"
                      ? "Unverified"
                      : f === "HELD"
                        ? "Needs Review"
                        : f[0] + f.slice(1).toLowerCase()}
                  </s-button>
                ))}
              </s-stack>
            </s-stack>
            {domains.length > 0 && (
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack gap="small">
                  <s-heading>Suspicious Email Domains</s-heading>
                  <s-text color="subdued">
                    Uncommon domains with many entrants, usually bot farms.
                    Disqualified entrants stop counting in draws; Restore puts
                    them back.
                  </s-text>
                  <s-table>
                    <s-table-header-row>
                      <s-table-header listSlot="primary">Domain</s-table-header>
                      <s-table-header format="numeric">Active</s-table-header>
                      <s-table-header format="numeric">
                        Disqualified
                      </s-table-header>
                      <s-table-header />
                    </s-table-header-row>
                    <s-table-body>
                      {domains.map((d) => (
                        <s-table-row key={d.domain}>
                          <s-table-cell>
                            {d.domain}
                            {d.blocked ? " (blocked)" : ""}
                          </s-table-cell>
                          <s-table-cell>
                            {d.active.toLocaleString()}
                          </s-table-cell>
                          <s-table-cell>
                            {d.disqualified.toLocaleString()}
                          </s-table-cell>
                          <s-table-cell>
                            <s-stack direction="inline" gap="small-200">
                              {d.active > 0 && (
                                <s-button
                                  tone="critical"
                                  disabled={busy}
                                  onClick={() =>
                                    submit({
                                      intent: "disqualifyDomain",
                                      domain: d.domain,
                                    })
                                  }
                                >
                                  Disqualify All
                                </s-button>
                              )}
                              {d.disqualified > 0 && (
                                <s-button
                                  variant="tertiary"
                                  disabled={busy}
                                  onClick={() =>
                                    submit({
                                      intent: "restoreDomain",
                                      domain: d.domain,
                                    })
                                  }
                                >
                                  Restore
                                </s-button>
                              )}
                            </s-stack>
                          </s-table-cell>
                        </s-table-row>
                      ))}
                    </s-table-body>
                  </s-table>
                </s-stack>
              </s-box>
            )}
            {entrants.length === 0 ? (
              <s-paragraph>No entrants here yet.</s-paragraph>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Entrant</s-table-header>
                  <s-table-header listSlot="inline">Status</s-table-header>
                  <s-table-header format="numeric">Entries</s-table-header>
                  <s-table-header format="numeric">Risk</s-table-header>
                  <s-table-header />
                </s-table-header-row>
                <s-table-body>
                  {entrants.map((e) => (
                    <s-table-row key={e.id}>
                      <s-table-cell>
                        <s-stack gap="none">
                          <s-link href={`${base}/entrants/${e.id}`}>
                            {e.name || e.email}
                          </s-link>
                          {e.name && <s-text color="subdued">{e.email}</s-text>}
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-badge tone={statusTone(e.status)}>
                          {e.status === "PENDING_VERIFICATION"
                            ? "unverified"
                            : e.status === "HELD"
                              ? "needs review"
                              : e.status.toLowerCase()}
                        </s-badge>
                      </s-table-cell>
                      <s-table-cell>{e.entries.toLocaleString()}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={riskTone(e.riskScore, e.status)}>
                          {e.riskScore}
                          {e.signals.length
                            ? ` · ${e.signals.join(", ").replaceAll("_", " ").toLowerCase()}`
                            : ""}
                        </s-badge>
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack direction="inline" gap="small-200">
                          {e.status !== "ACTIVE" &&
                            e.status !== "DISQUALIFIED" && (
                              <s-button
                                onClick={() =>
                                  submit({ intent: "approve", entrantId: e.id })
                                }
                              >
                                Approve
                              </s-button>
                            )}
                          {e.status !== "DISQUALIFIED" && (
                            <s-button
                              tone="critical"
                              onClick={() =>
                                submit({
                                  intent: "disqualify",
                                  entrantId: e.id,
                                })
                              }
                            >
                              Disqualify
                            </s-button>
                          )}
                        </s-stack>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
          </s-stack>
        </s-section>
      )}

      {tab === "orders" && (
        <s-section heading="Orders">
          <s-stack gap="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-text color="subdued">
                Only orders placed after {startsLabel} earn entries.
              </s-text>
              <s-button
                variant="tertiary"
                onClick={() => submit({ intent: "removePreStart" })}
                loading={flag(
                  busy && fetcher.formData?.get("intent") === "removePreStart",
                )}
              >
                Remove Entries From Older Orders
              </s-button>
            </s-stack>
            {orders.length === 0 ? (
              <s-paragraph>
                Orders placed while this giveaway is live show here with the
                entries they earned.
              </s-paragraph>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Order</s-table-header>
                  <s-table-header>Placed</s-table-header>
                  <s-table-header>Customer</s-table-header>
                  <s-table-header listSlot="inline">Result</s-table-header>
                  <s-table-header format="numeric">Entries</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {orders.map((o) => (
                    <s-table-row key={o.id}>
                      <s-table-cell>{o.name}</s-table-cell>
                      <s-table-cell>{o.placed ?? "—"}</s-table-cell>
                      <s-table-cell>{o.email ?? "—"}</s-table-cell>
                      <s-table-cell>{o.status}</s-table-cell>
                      <s-table-cell>{o.entries.toLocaleString()}</s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
          </s-stack>
        </s-section>
      )}

      {tab === "draws" && <DrawsSection draws={draws} extras={drawExtras} />}

      <s-section slot="aside" heading="On Your Store">
        <s-stack gap="small-200">
          <s-text>
            Link name: <s-text type="strong">{campaign.slug}</s-text>
          </s-text>
          <s-text color="subdued">{storefrontPath}</s-text>
        </s-stack>
      </s-section>
      <s-section slot="aside" heading="Ways To Enter">
        <s-stack gap="small-200">
          {campaign.actions.map((a) => (
            <s-stack
              key={a.id}
              direction="inline"
              justifyContent="space-between"
              gap="base"
            >
              <s-text>{a.label}</s-text>
              <s-text color="subdued">+{a.entries}</s-text>
            </s-stack>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value.toLocaleString()}</s-heading>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

function NewSignups({ growth }: { growth: GrowthData }) {
  const stat = (label: string, value: number, sub: string) => (
    <s-stack gap="small-200">
      <s-text color="subdued">{label}</s-text>
      <s-heading>{value.toLocaleString()}</s-heading>
      <s-text color="subdued">{sub}</s-text>
    </s-stack>
  );
  const checked = growth.signups - growth.unchecked;
  return (
    <s-stack gap="base">
      <s-grid
        gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
        gap="base"
      >
        {stat(
          "New Customers",
          growth.newCustomers,
          `of ${checked.toLocaleString()} sign-ups checked`,
        )}
        {stat(
          "New Email Subscribers",
          growth.email.new,
          `of ${growth.email.optIns.toLocaleString()} email opt-ins (${(growth.email.optIns - growth.email.new).toLocaleString()} already subscribed)`,
        )}
        {stat(
          "New SMS Subscribers",
          growth.sms.new,
          `of ${growth.sms.optIns.toLocaleString()} SMS opt-ins (${(growth.sms.optIns - growth.sms.new).toLocaleString()} already subscribed)`,
        )}
      </s-grid>
      <s-text color="subdued">
        {growth.unchecked > 0
          ? `Checking ${growth.unchecked.toLocaleString()} more sign-ups against Shopify. Refresh in a minute. `
          : ""}
        Based on each Shopify customer&apos;s created date and consent date, so
        counts are close, not exact. Imported entrants aren&apos;t counted.
      </s-text>
    </s-stack>
  );
}
