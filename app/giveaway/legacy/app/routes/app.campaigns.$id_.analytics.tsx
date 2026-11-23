import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { campaignAnalytics, type DayPoint } from "../lib/analytics.server";
import { downloadFile } from "../lib/download";
import { EntriesByMethodTable } from "../components/EntriesByMethod";
import { Select } from "../components/fields";
import { resolveRange, type RangePreset } from "../lib/analytics-range";
import { drawHistory } from "../lib/daily.server";
import { parseSettings } from "../lib/settings";
import {
  PLATFORM_LABELS,
  followClickTable,
  recentDates,
} from "../lib/follow-clicks";
import { followClickStats } from "../lib/follow-clicks.server";

// Named with "$id_" so it renders as its own page instead of nesting inside
// the campaign page (which has no <Outlet />). URL: /staff/cardbit-campaigns/campaigns/:id/analytics.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const campaign = await db.campaign.findFirst({
    where: { id: params.id, shop: session.shop },
  });
  if (!campaign) throw new Response("Not found", { status: 404 });
  const daily = parseSettings(campaign.settings).daily;
  const range = resolveRange(new URL(request.url).searchParams, {
    timeZone: campaign.timezone,
    drawTime: daily.enabled ? daily.drawTime : null,
  });
  const [stats, draws, clicks] = await Promise.all([
    campaignAnalytics(campaign, range),
    daily.enabled ? drawHistory(campaign) : Promise.resolve([]),
    followClickStats({ days: 14, shop: session.shop, giveaway: campaign.slug }),
  ]);
  return {
    campaign: { id: campaign.id, title: campaign.title },
    daily: daily.enabled,
    timezone: campaign.timezone,
    range: {
      preset: range.preset,
      draw: range.draw,
      from: range.from,
      to: range.to,
      start: range.start?.toISOString() ?? null,
      end: range.end?.toISOString() ?? null,
    },
    draws,
    stats,
    followClicks: followClickTable(clicks, recentDates(14)),
  };
};

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const money = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD" });

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom Dates" },
  { value: "all", label: "All Time" },
];

const shortDay = (ymd: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${ymd}T12:00:00Z`));

export default function CampaignAnalytics() {
  const { campaign, stats, range, draws, daily, timezone, followClicks } =
    useLoaderData<typeof loader>();
  const { totals, revenue, conversion } = stats;
  const navigate = useNavigate();
  const go = (params: Record<string, string>) => {
    const next = `?${new URLSearchParams(params)}`;
    if (next !== window.location.search) navigate(next, { replace: true });
  };
  const current = draws.find((d) => d.key === range.draw) ?? null;
  const [from, setFrom] = useState(range.from ?? "");
  const [to, setTo] = useState(range.to ?? "");
  const pick =
    range.preset === "draw" ? `draw:${range.draw}` : (range.preset as string);
  const options = [
    ...(daily
      ? draws.map((d) => ({
          value: `draw:${d.key}`,
          label: `Draw ${shortDay(d.key)} · ${d.title}${d.status === "RESERVED" ? " (Live)" : ""}`,
        }))
      : []),
    ...(range.preset === "draw" && !current
      ? [{ value: pick, label: `Draw ${shortDay(range.draw!)}` }]
      : []),
    ...PRESETS,
  ];
  const when = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  const [error, setError] = useState<string | null>(null);
  const base = `/staff/cardbit-campaigns/campaigns/${campaign.id}`;
  const download = (query: string, name: string) =>
    downloadFile(`${base}/export?${query}`, name).catch((e: Error) =>
      setError(e.message),
    );

  return (
    <s-page heading={`${campaign.title}: Analytics`}>
      <s-link slot="breadcrumb-actions" href={base}>
        Back To Giveaway
      </s-link>
      <s-button
        slot="secondary-actions"
        onClick={() => download("type=entrants", "entrants.csv")}
      >
        Export Entrants
      </s-button>
      <s-button
        slot="secondary-actions"
        onClick={() => download("type=orders", "orders.csv")}
      >
        Export Order Log
      </s-button>
      {error && <s-banner tone="critical">{error}</s-banner>}

      <s-section heading="Showing">
        <s-stack gap="base">
          <s-grid gridTemplateColumns="1fr 1fr" gap="base" alignItems="end">
            <Select
              label={daily ? "Draw Or Dates" : "Dates"}
              value={pick}
              options={options}
              onChange={(v) => {
                if (v.startsWith("draw:"))
                  go({ range: "draw", draw: v.slice(5) });
                else if (v === "custom")
                  go({
                    range: "custom",
                    from: from || range.from || "",
                    to: to || range.to || "",
                  });
                else go({ range: v });
              }}
            />
            {range.preset === "custom" && (
              <s-stack direction="inline" gap="small-200" alignItems="end">
                <label>
                  <s-text>From</s-text>
                  <br />
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.currentTarget.value)}
                  />
                </label>
                <label>
                  <s-text>To</s-text>
                  <br />
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.currentTarget.value)}
                  />
                </label>
                <s-button
                  onClick={() => go({ range: "custom", from, to: to || from })}
                >
                  Apply
                </s-button>
              </s-stack>
            )}
          </s-grid>
          <s-text color="subdued">
            {range.start && range.end
              ? `${when(range.start)} to ${when(range.end)}`
              : "Everything since the giveaway started"}
            {range.preset === "draw" &&
              ". Only entries earned in this window count toward this draw."}
          </s-text>
          {current && (
            <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
              <Stat label="Prize" value={current.title} />
              <Stat
                label="In The Draw"
                value={current.entrants.toLocaleString()}
                hint="People with entries this day who finished the required steps"
              />
              <Stat
                label="Entries In The Draw"
                value={current.entries.toLocaleString()}
              />
              <Stat
                label="Winner"
                value={
                  current.winner ??
                  (current.status === "RESERVED" ? "Not Drawn Yet" : "None")
                }
              />
            </s-grid>
          )}
        </s-stack>
      </s-section>

      <s-section>
        <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
          <Stat
            label="People Who Earned Entries"
            value={stats.activity.people.toLocaleString()}
            hint="New and returning"
          />
          <Stat
            label="Entries Earned"
            value={stats.activity.entries.toLocaleString()}
          />
          <Stat label="New Sign-Ups" value={totals.entrants.toLocaleString()} />
          <Stat
            label="Verified"
            value={pct(totals.verificationRate)}
            hint={`${totals.verified.toLocaleString()} entrants`}
          />
          <Stat
            label="Held For Review"
            value={pct(totals.holdRate)}
            hint={`${totals.held.toLocaleString()} entrants`}
          />
          <Stat
            label="Disqualified"
            value={pct(totals.disqualifiedRate)}
            hint={`${totals.disqualified.toLocaleString()} entrants`}
          />
          <Stat
            label="Revenue From Entry Orders"
            value={money(revenue.revenue)}
            hint={
              revenue.missing
                ? `${revenue.missing} older orders have no amount saved`
                : "Order subtotals"
            }
          />
          <Stat
            label="Orders That Earned Entries"
            value={revenue.orders.toLocaleString()}
          />
          <Stat
            label="Entrants Who Bought"
            value={pct(conversion.rate)}
            hint={`${conversion.formBuyers} of ${conversion.formEntrants} form sign-ups`}
          />
          <Stat
            label="Buyers In The Giveaway"
            value={conversion.buyers.toLocaleString()}
            hint="Includes sign-ups created from orders"
          />
        </s-grid>
      </s-section>

      {daily && draws.length > 0 && (
        <s-section heading="Daily Draws">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Draw</s-table-header>
              <s-table-header>Prize</s-table-header>
              <s-table-header format="numeric">People</s-table-header>
              <s-table-header format="numeric">Entries</s-table-header>
              <s-table-header>Winner</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {draws.map((d) => (
                <s-table-row key={d.key}>
                  <s-table-cell>
                    <s-link href={`?range=draw&draw=${d.key}`}>
                      {shortDay(d.key)}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{d.title}</s-table-cell>
                  <s-table-cell>{d.entrants.toLocaleString()}</s-table-cell>
                  <s-table-cell>{d.entries.toLocaleString()}</s-table-cell>
                  <s-table-cell>
                    {d.winner ?? (d.status === "RESERVED" ? "Live" : "—")}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      <s-section heading="New Sign-Ups Per Day">
        <BarChart days={stats.days} field="entrants" />
      </s-section>
      <s-section heading="Entries Awarded Per Day">
        <BarChart days={stats.days} field="entries" />
      </s-section>

      <s-section heading="Follow Button Clicks (Last 14 Days)">
        <s-stack gap="base">
          <s-text color="subdued">
            Taps on the follow and join buttons that opened the link, counted
            once per browser per day. Days are in Central Time.
          </s-text>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Day</s-table-header>
              {followClicks.platforms.map((p) => (
                <s-table-header key={p} format="numeric">
                  {PLATFORM_LABELS[p]}
                </s-table-header>
              ))}
            </s-table-header-row>
            <s-table-body>
              {followClicks.days.map((d) => (
                <s-table-row key={d.date}>
                  <s-table-cell>{shortDay(d.date)}</s-table-cell>
                  {d.counts.map((n, i) => (
                    <s-table-cell key={followClicks.platforms[i]}>
                      {n.toLocaleString()}
                    </s-table-cell>
                  ))}
                </s-table-row>
              ))}
              <s-table-row>
                <s-table-cell>
                  <s-text type="strong">Total</s-text>
                </s-table-cell>
                {followClicks.totals.map((n, i) => (
                  <s-table-cell key={followClicks.platforms[i]}>
                    <s-text type="strong">{n.toLocaleString()}</s-text>
                  </s-table-cell>
                ))}
              </s-table-row>
            </s-table-body>
          </s-table>
        </s-stack>
      </s-section>

      <s-section heading="Entries By Method">
        <EntriesByMethodTable rows={stats.methods} />
      </s-section>

      <s-section heading="Top Referrers">
        {stats.topReferrers.length === 0 ? (
          <s-paragraph>No referrals yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Entrant</s-table-header>
              <s-table-header format="numeric">Referrals</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {stats.topReferrers.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    {r.name ? `${r.name} (${r.email})` : r.email}
                  </s-table-cell>
                  <s-table-cell>{r.referrals}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Traffic Sources (UTM)">
        {stats.utm.length === 0 ? (
          <s-paragraph>No entrants yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">utm_source</s-table-header>
              <s-table-header format="numeric">Entrants</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {stats.utm.map((u) => (
                <s-table-row key={u.source}>
                  <s-table-cell>{u.source}</s-table-cell>
                  <s-table-cell>{u.count.toLocaleString()}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
      <s-section slot="aside" heading="How These Are Counted">
        <s-paragraph>
          Days use the giveaway&apos;s timezone. A daily draw runs from the
          previous draw to this one (e.g. 9pm to 9pm), and only entries earned
          in it count toward that draw. New sign-ups, statuses, referrals,
          traffic sources and orders count by when they were created; entries by
          when they were earned. Revenue is the subtotal of orders that earned
          entries. &quot;Entrants Who Bought&quot; counts people who signed up
          through the giveaway form and also have an order in the log.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
        {hint && <s-text color="subdued">{hint}</s-text>}
      </s-stack>
    </s-box>
  );
}

/** Plain SVG bar chart; scales to the container width. */
function BarChart({
  days,
  field,
}: {
  days: DayPoint[];
  field: "entrants" | "entries";
}) {
  if (days.length === 0) return <s-paragraph>No activity yet.</s-paragraph>;
  const W = 720;
  const H = 180;
  const pad = { top: 16, bottom: 22, left: 4 };
  const max = Math.max(1, ...days.map((d) => d[field]));
  const slot = (W - pad.left) / days.length;
  const bar = Math.max(1, slot * 0.75);
  const plotH = H - pad.top - pad.bottom;
  const labelEvery = Math.ceil(days.length / 8);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={`${field} per day, peak ${max.toLocaleString()}`}
      style={{ display: "block" }}
    >
      <text x={W} y={11} textAnchor="end" fontSize="11" fill="#616161">
        peak {max.toLocaleString()}
      </text>
      <line
        x1={0}
        x2={W}
        y1={H - pad.bottom}
        y2={H - pad.bottom}
        stroke="#e3e3e3"
      />
      {days.map((d, i) => {
        const h = (d[field] / max) * plotH;
        const x = pad.left + i * slot + (slot - bar) / 2;
        return (
          <g key={d.day}>
            <rect
              x={x}
              y={H - pad.bottom - h}
              width={bar}
              height={h}
              rx={Math.min(3, bar / 3)}
              fill="#303030"
            >
              <title>
                {d.day}: {d[field].toLocaleString()}
              </title>
            </rect>
            {i % labelEvery === 0 && (
              <text
                x={x + bar / 2}
                y={H - 6}
                textAnchor="middle"
                fontSize="11"
                fill="#616161"
              >
                {d.day.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
