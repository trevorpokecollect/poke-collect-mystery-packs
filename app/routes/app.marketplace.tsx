import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { demoToken } from "../lib/demo.server";
import { gql } from "../lib/orders.server";
import { resolveCustomer } from "../lib/vault.server";
import { adjustCredit, collectionsWithPacks } from "../lib/credit.server";
import {
  clearRefundFlag,
  marketActivity,
  marketSettings,
  releaseFlaggedPayout,
  reverseSale,
  reverseTrade,
  setTradeName,
  updateMarketSettings,
} from "../lib/market.server";
import {
  marketOverview,
  openListings,
  openOffers,
  playerProfile,
  staffCancelListing,
  staffCancelOffer,
  traderByName,
} from "../lib/market-admin.server";
import type { MarketDay } from "../lib/market-report.server";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "listings", label: "For Sale" },
  { id: "offers", label: "Trade Offers" },
  { id: "sales", label: "Sales" },
  { id: "trades", label: "Trades" },
  { id: "players", label: "Players" },
  { id: "settings", label: "Settings" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const json = <T,>(value: T) => JSON.parse(JSON.stringify(value)) as T;

// Vault Marketplace: how the market is doing, the open market staff can moderate, customer service
// for trades and sales (reverse, hold or release credit), a player lookup, and the on/off switches.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const tab = (TABS.find((t) => t.id === url.searchParams.get("tab"))?.id ?? "overview") as Tab;
  const q = (url.searchParams.get("q") ?? "").trim();
  const player = (url.searchParams.get("player") ?? "").trim();

  const [settings, row, flaggedCount] = await Promise.all([
    marketSettings(db, shop),
    db.marketSettings.findUnique({ where: { shop } }),
    db.pull.count({ where: { shop, refundFlaggedAt: { not: null } } }),
  ]);
  const base = {
    tab,
    q,
    player,
    flaggedCount,
    previewUrl: `https://${shop}/apps/packs/market?demo=${demoToken(shop)}`,
    settings: { ...settings, sellingSwitch: row?.sellingEnabled ?? false },
  };

  const overview = tab === "overview" ? json(await marketOverview(db, shop)) : null;
  const activity = tab === "overview" || tab === "sales" || tab === "trades" ? json(await marketActivity(db, shop, 200)) : null;
  const listings = tab === "listings" ? json(await openListings(db, shop, q)) : null;
  const offers = tab === "offers" ? json(await openOffers(db, shop)) : null;

  let profile: Awaited<ReturnType<typeof playerProfile>> | null = null;
  let playerError: string | null = null;
  if (tab === "players" && player) {
    try {
      const byName = await traderByName(db, shop, player);
      const customerId = byName?.customerId ?? (await resolveCustomer(db, admin, player)).customerId;
      profile = json(await playerProfile(db, shop, customerId));
    } catch (error) {
      playerError = error instanceof Error ? error.message : "No player found.";
    }
  }
  const leaders = tab === "players" && !player ? json(await marketOverview(db, shop)) : null;

  let credit = null;
  let collections: { id: string; title: string }[] = [];
  if (tab === "settings") {
    collections = await gql(admin, `#graphql
      query CreditCollections { collections(first: 250, sortKey: TITLE) { nodes { id title } } }`)
      .then((d) => d.collections.nodes as { id: string; title: string }[])
      .catch(() => [] as { id: string; title: string }[]);
    credit = {
      collectionIds: row?.creditCollectionIds ?? [],
      combines: row?.creditCombines ?? false,
      outstanding: Number((await db.creditTxn.aggregate({ where: { shop }, _sum: { amount: true } }))._sum.amount ?? 0),
      openCodes: await db.creditCode.count({ where: { shop, status: "ACTIVE" } }),
    };
  }

  return { ...base, overview, activity, listings, offers, profile, playerError, leaders, credit, collections };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const id = String(form.get("id") || "");
  try {
    switch (form.get("intent")) {
      case "settings":
        await updateMarketSettings(db, shop, {
          enabled: form.get("enabled") === "on",
          sellingEnabled: form.get("selling") === "on",
          feePercent: Number(form.get("fee")),
          accessTag: String(form.get("accessTag") || "").trim() || null,
        });
        return { ok: "Marketplace settings saved." };
      case "credit": {
        const ids = form.getAll("collection").map(String).filter(Boolean);
        const withPacks = await collectionsWithPacks(admin, ids);
        if (withPacks.length) return { error: `These collections include a Mystery Pack, so Vault Credit could buy packs through them: ${withPacks.join(", ")}. Untick them and save again.` };
        await updateMarketSettings(db, shop, { creditCollectionIds: ids, creditCombines: form.get("combines") === "on" });
        return { ok: ids.length ? `Vault Credit codes now work on ${ids.length} collection${ids.length === 1 ? "" : "s"}.` : "Vault Credit codes are off until you pick a collection." };
      }
      case "adjust": {
        const who = await resolveCustomer(db, admin, String(form.get("customer") || ""));
        const amount = Number(form.get("amount"));
        if (!Number.isFinite(amount) || amount === 0) return { error: "Enter an amount other than zero." };
        const reason = String(form.get("reason") || "").trim();
        if (!reason) return { error: "Add a reason so the player's history explains the change." };
        await adjustCredit(db, shop, who.customerId, amount, reason);
        return { ok: `Adjusted ${who.label}'s Vault Credit by $${amount.toFixed(2)}.` };
      }
      case "rename": {
        await setTradeName(db, shop, String(form.get("customerId") || ""), String(form.get("tradeName") || ""));
        return { ok: "Trade name changed." };
      }
      case "cancelListing":
        await staffCancelListing(db, shop, id);
        return { ok: "Listing taken down. The card is back in the player's vault." };
      case "cancelOffer":
        await staffCancelOffer(db, shop, id);
        return { ok: "Offer withdrawn." };
      case "reverseTrade":
        await reverseTrade(db, shop, id);
        return { ok: "Trade reversed. Every card is back with its original owner." };
      case "reverseSale":
        await reverseSale(db, shop, id);
        return { ok: "Sale reversed. The card is back with the seller and their Vault Credit was taken back. A card bought with Vault Credit refunds the buyer automatically; refund a card payment in Shopify." };
      case "releasePayout":
        await releaseFlaggedPayout(db, shop, id);
        return { ok: "The seller's Vault Credit will be paid on the next run once the hold has passed." };
      case "clearFlag":
        await clearRefundFlag(db, shop, id);
        return { ok: "Marked as reviewed. The card stays with its current owner." };
      default:
        return { error: "Unknown action." };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "That didn't work. Please try again." };
  }
};

const day = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
const dayTime = (d: string | Date | null) =>
  d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const payoutLabel: Record<string, string> = { HELD: "Held", PAYING: "Paying", PAID: "Paid", FLAGGED: "Flagged", CANCELLED: "Reversed" };
const payoutTone = { HELD: "info", PAYING: "info", PAID: "success", FLAGGED: "critical", CANCELLED: "neutral" } as const;
const tradeTone = { PENDING: "info", ACCEPTED: "success", DECLINED: "neutral", CANCELLED: "neutral", EXPIRED: "neutral", REVERSED: "warning" } as const;
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

type Loader = ReturnType<typeof useLoaderData<typeof loader>>;

export default function Marketplace() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const [params, setParams] = useSearchParams();
  const submit = useSubmit();
  const busy = useNavigation().state !== "idle";
  const [armed, setArmed] = useState<string | null>(null);
  const confirmThen = (key: string, payload: Record<string, string>) => {
    if (armed !== key) return setArmed(key);
    setArmed(null);
    submit(payload, { method: "post" });
  };
  const go = (next: Record<string, string>) => setParams(next);
  const ctx = { busy, armed, confirmThen, submit, go };

  return (
    <s-page heading="Vault Marketplace" inlineSize="large">
      <s-button slot="secondary-actions" href={data.previewUrl} target="_blank">
        Preview Marketplace
      </s-button>
      <s-stack gap="base">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-badge tone={data.settings.enabled ? "success" : "neutral"}>{data.settings.enabled ? "Trading On" : "Trading Off"}</s-badge>
          <s-badge tone={data.settings.sellingSwitch ? "success" : "neutral"}>{data.settings.sellingSwitch ? "Selling On" : "Selling Off"}</s-badge>
          <s-badge tone="info">{data.settings.feePercent}% Fee</s-badge>
          {data.settings.accessTag ? <s-badge tone="warning">Soft Launch: {data.settings.accessTag}</s-badge> : null}
        </s-stack>
        <s-stack direction="inline" gap="small-200">
          {TABS.map((t) => (
            <s-button key={t.id} variant={data.tab === t.id ? "primary" : "secondary"} onClick={() => go({ tab: t.id })}>
              {t.label}
            </s-button>
          ))}
        </s-stack>
        {data.flaggedCount && data.tab !== "overview" ? (
          <s-banner tone="warning">
            {plural(data.flaggedCount, "refunded pack card")} traded or sold to another player need review on the Overview tab.
          </s-banner>
        ) : null}
        {result && "error" in result ? <s-banner tone="critical">{result.error}</s-banner> : null}
        {result && "ok" in result ? <s-banner tone="success">{result.ok}</s-banner> : null}
        {armed ? <s-banner tone="warning">Click the button again to confirm.</s-banner> : null}
      </s-stack>

      {data.tab === "overview" && data.overview && data.activity ? <Overview data={data} ctx={ctx} /> : null}
      {data.tab === "listings" && data.listings ? <Listings data={data} ctx={ctx} /> : null}
      {data.tab === "offers" && data.offers ? <Offers data={data} ctx={ctx} /> : null}
      {data.tab === "sales" && data.activity ? <Sales sales={data.activity.sales} ctx={ctx} q={params.get("q") ?? ""} /> : null}
      {data.tab === "trades" && data.activity ? <Trades trades={data.activity.trades} ctx={ctx} q={params.get("q") ?? ""} /> : null}
      {data.tab === "players" ? <Players data={data} ctx={ctx} /> : null}
      {data.tab === "settings" && data.credit ? <Settings data={data} busy={busy} /> : null}
    </s-page>
  );
}

type Ctx = {
  busy: boolean;
  armed: string | null;
  confirmThen: (key: string, payload: Record<string, string>) => void;
  submit: ReturnType<typeof useSubmit>;
  go: (next: Record<string, string>) => void;
};

// ---------- Overview ----------

function Stat({ label, value, change, hint }: { label: string; value: string; change?: number | null; hint?: string }) {
  return (
    <s-box padding="base" background="subdued" borderRadius="base" border="base">
      <s-stack gap="small-300">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
        {change !== undefined && change !== null ? (
          <s-text color="subdued">
            {change === 0 ? "Same as" : `${change > 0 ? "▲" : "▼"} ${Math.abs(change).toLocaleString()} vs`} last week
          </s-text>
        ) : null}
        {hint ? <s-text color="subdued">{hint}</s-text> : null}
      </s-stack>
    </s-box>
  );
}

// One small bar chart per measure (single series each), oldest day on the left, with a hover tooltip per bar.
function DayBars({ days, pick, label, format = (n: number) => String(n) }: {
  days: MarketDay[];
  pick: (d: MarketDay) => number;
  label: string;
  format?: (n: number) => string;
}) {
  const series = [...days].reverse();
  const max = Math.max(1, ...series.map(pick));
  const total = series.reduce((n, d) => n + pick(d), 0);
  const w = 300;
  const h = 90;
  const slot = w / series.length;
  const bar = Math.max(2, slot - 2);
  return (
    <s-box padding="base" borderRadius="base" border="base">
      <s-stack gap="small-200">
        <s-stack direction="inline" justifyContent="space-between">
          <s-text type="strong">{label}</s-text>
          <s-text color="subdued">{format(total)} in 30 days</s-text>
        </s-stack>
        <svg viewBox={`0 0 ${w} ${h + 16}`} width="100%" role="img" aria-label={`${label} per day, last 30 days`} style={{ display: "block" }}>
          <style>{`.vm-bar{fill:#2a78d6}.vm-hit:hover+.vm-bar,.vm-bar:hover{fill:#1d5aa3}.vm-axis{stroke:#e1e3e5;stroke-width:1}.vm-lab{font:10px system-ui,sans-serif;fill:#616161}`}</style>
          <line className="vm-axis" x1={0} x2={w} y1={h} y2={h} />
          {series.map((d, i) => {
            const v = pick(d);
            const bh = v ? Math.max(3, (v / max) * (h - 6)) : 0;
            const x = i * slot + (slot - bar) / 2;
            const tip = `${new Date(`${d.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}: ${format(v)}`;
            return (
              <g key={d.day}>
                <rect className="vm-hit" x={i * slot} y={0} width={slot} height={h} fill="transparent">
                  <title>{tip}</title>
                </rect>
                {bh ? (
                  <rect className="vm-bar" x={x} y={h - bh} width={bar} height={bh} rx={Math.min(2, bar / 2)} pointerEvents="none" />
                ) : null}
              </g>
            );
          })}
          <text className="vm-lab" x={0} y={h + 13}>
            {day(`${series[0]?.day}T12:00:00Z`)}
          </text>
          <text className="vm-lab" x={w} y={h + 13} textAnchor="end">
            Today
          </text>
        </svg>
      </s-stack>
    </s-box>
  );
}

function downloadCsv(days: MarketDay[]) {
  const head = "day,listed,sold,sales,sold_with_credit,reversed_sales,trades,cards_traded,reversed_trades";
  const rows = days.map((d) =>
    [d.day, d.listed, d.sold, d.soldValue.toFixed(2), d.soldWithCredit, d.reversedSales, d.trades, d.cardsTraded, d.reversedTrades].join(","),
  );
  const blob = new Blob([[head, ...rows].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `vault-market-daily-${days[0]?.day ?? "report"}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Overview({ data, ctx }: { data: Loader; ctx: Ctx }) {
  const o = data.overview!;
  const flagged = data.activity!.flagged;
  const delta = (k: keyof typeof o.thisWeek) => Math.round((o.thisWeek[k] - o.lastWeek[k]) * 100) / 100;
  return (
    <>
      {flagged.length ? (
        <s-section heading="Refunds On Traded Cards">
          <s-stack gap="base">
            <s-banner tone="warning">
              These pack orders were refunded after the card was traded or sold to another player. The card stayed with its new
              owner; settle the refund as money only, then mark it reviewed.
            </s-banner>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Card</s-table-header>
                <s-table-header>Pack Order</s-table-header>
                <s-table-header>Owner Now</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {flagged.map((f) => (
                  <s-table-row key={f.pullId}>
                    <s-table-cell>{f.card}</s-table-cell>
                    <s-table-cell>{f.orderName}</s-table-cell>
                    <s-table-cell>{f.owner}</s-table-cell>
                    <s-table-cell>
                      <s-button disabled={ctx.busy} onClick={() => ctx.submit({ intent: "clearFlag", id: f.pullId }, { method: "post" })}>
                        Mark Reviewed
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-stack>
        </s-section>
      ) : null}

      <s-section heading="Last 7 Days">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(150px, 1fr))" gap="base">
          <Stat label="Cards Listed" value={o.thisWeek.listed.toLocaleString()} change={delta("listed")} />
          <Stat label="Cards Sold" value={o.thisWeek.sold.toLocaleString()} change={delta("sold")} />
          <Stat label="Sales" value={money(o.thisWeek.soldValue)} hint={`Last week ${money(o.lastWeek.soldValue)}`} />
          <Stat label="Fees Earned" value={money(o.feesThisWeek)} hint={`${data.settings.feePercent}% of each sale`} />
          <Stat label="Trades" value={o.thisWeek.trades.toLocaleString()} change={delta("trades")} />
          <Stat label="Cards Traded" value={o.thisWeek.cardsTraded.toLocaleString()} change={delta("cardsTraded")} />
        </s-grid>
      </s-section>

      <s-section heading="Right Now">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(150px, 1fr))" gap="base">
          <s-clickable onClick={() => ctx.go({ tab: "listings" })} borderRadius="base">
            <Stat label="Cards For Sale" value={o.open.activeListings.toLocaleString()} hint="View For Sale →" />
          </s-clickable>
          <s-clickable onClick={() => ctx.go({ tab: "offers" })} borderRadius="base">
            <Stat label="Open Trade Offers" value={o.open.pendingOffers.toLocaleString()} hint="View Offers →" />
          </s-clickable>
          <s-clickable onClick={() => ctx.go({ tab: "players" })} borderRadius="base">
            <Stat label="Players With Trade Names" value={o.open.traders.toLocaleString()} hint="Find A Player →" />
          </s-clickable>
          <Stat label="Outstanding Vault Credit" value={money(o.outstandingCredit)} hint="Owed to players, unspent" />
        </s-grid>
      </s-section>

      <s-section heading="Last 30 Days">
        <s-stack gap="base">
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap="base">
            <DayBars days={o.daily} pick={(d) => d.listed} label="Cards Listed" />
            <DayBars days={o.daily} pick={(d) => d.sold} label="Cards Sold" />
            <DayBars days={o.daily} pick={(d) => d.trades} label="Trades" />
          </s-grid>
          <s-stack direction="inline" justifyContent="space-between" alignItems="center">
            <s-text color="subdued">Days run midnight to midnight, Central time. Hover a bar for that day.</s-text>
            <s-button icon="export" onClick={() => downloadCsv(o.daily)}>
              Download CSV
            </s-button>
          </s-stack>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Day</s-table-header>
              <s-table-header format="numeric">Listed</s-table-header>
              <s-table-header format="numeric">Sold</s-table-header>
              <s-table-header format="numeric">Sales</s-table-header>
              <s-table-header format="numeric">Trades</s-table-header>
              <s-table-header format="numeric">Cards Traded</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {o.daily.map((d) => (
                <s-table-row key={d.day}>
                  <s-table-cell>{new Date(`${d.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</s-table-cell>
                  <s-table-cell>{d.listed}</s-table-cell>
                  <s-table-cell>
                    {d.sold}
                    {d.soldWithCredit ? ` (${d.soldWithCredit} credit)` : ""}
                    {d.reversedSales ? ` · ${d.reversedSales} reversed` : ""}
                  </s-table-cell>
                  <s-table-cell>{money(d.soldValue)}</s-table-cell>
                  <s-table-cell>
                    {d.trades}
                    {d.reversedTrades ? ` · ${d.reversedTrades} reversed` : ""}
                  </s-table-cell>
                  <s-table-cell>{d.cardsTraded}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-stack>
      </s-section>

      <s-section heading="Most Active Players (30 Days)">
        <Leaders overview={o} go={ctx.go} />
      </s-section>
    </>
  );
}

function Leaders({ overview, go }: { overview: NonNullable<Loader["overview"]>; go: Ctx["go"] }) {
  const open = (name: string) => go({ tab: "players", player: name });
  return (
    <s-grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap="base">
      <s-box padding="base" borderRadius="base" border="base">
        <s-stack gap="small">
          <s-text type="strong">Top Sellers</s-text>
          {overview.topSellers.length === 0 ? <s-text color="subdued">No sales yet.</s-text> : null}
          {overview.topSellers.map((s) => (
            <s-stack key={s.customerId} direction="inline" justifyContent="space-between">
              <s-link onClick={() => open(s.name)}>{s.name}</s-link>
              <s-text color="subdued">
                {plural(s.sold, "card")} · {money(s.value)}
              </s-text>
            </s-stack>
          ))}
        </s-stack>
      </s-box>
      <s-box padding="base" borderRadius="base" border="base">
        <s-stack gap="small">
          <s-text type="strong">Top Traders</s-text>
          {overview.topTraders.length === 0 ? <s-text color="subdued">No trades yet.</s-text> : null}
          {overview.topTraders.map((t) => (
            <s-stack key={t.customerId} direction="inline" justifyContent="space-between">
              <s-link onClick={() => open(t.name)}>{t.name}</s-link>
              <s-text color="subdued">{plural(t.trades, "trade")}</s-text>
            </s-stack>
          ))}
        </s-stack>
      </s-box>
    </s-grid>
  );
}

// ---------- The open market ----------

function SearchBar({ tab, q, placeholder, go }: { tab: string; q: string; placeholder: string; go: Ctx["go"] }) {
  return (
    <Form method="get" onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get("q") || ""); go(v ? { tab, q: v } : { tab }); }}>
      <s-stack direction="inline" gap="small" alignItems="end">
        <div style={{ flex: 1, minWidth: 220 }}>
          <s-search-field name="q" label="Search" labelAccessibilityVisibility="exclusive" placeholder={placeholder} defaultValue={q} />
        </div>
        <s-button type="submit">Search</s-button>
        {q ? <s-button variant="tertiary" onClick={() => go({ tab })}>Clear</s-button> : null}
      </s-stack>
    </Form>
  );
}

function Listings({ data, ctx }: { data: Loader; ctx: Ctx }) {
  const listings = data.listings!;
  return (
    <s-section heading={`Cards For Sale (${listings.length})`}>
      <s-stack gap="base">
        <s-paragraph>
          Every card players have up for sale. Take a listing down if it was a mistake or breaks the rules; the card goes back
          to the player&apos;s vault. A card a buyer is checking out can&apos;t be taken down until the checkout ends.
        </s-paragraph>
        <SearchBar tab="listings" q={data.q} placeholder="Card name" go={ctx.go} />
        {listings.length === 0 ? (
          <s-paragraph>{data.q ? "No cards for sale match that search." : "Nothing is for sale right now."}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Card</s-table-header>
              <s-table-header>Seller</s-table-header>
              <s-table-header format="numeric">Price</s-table-header>
              <s-table-header>Listed</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {listings.map((l) => (
                <s-table-row key={l.id}>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small" alignItems="center">
                      {l.image ? <s-thumbnail src={l.image} alt={l.card} size="small" /> : null}
                      <s-stack gap="none">
                        <s-text type="strong">{l.card}</s-text>
                        {l.status === "CHECKOUT" ? (
                          <s-text color="subdued">
                            {l.buyer} checking out until {dayTime(l.checkoutExpiresAt)}
                          </s-text>
                        ) : null}
                      </s-stack>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-link onClick={() => ctx.go({ tab: "players", player: l.seller })}>{l.seller}</s-link>
                  </s-table-cell>
                  <s-table-cell>{money(l.price)}</s-table-cell>
                  <s-table-cell>{day(l.listedAt)}</s-table-cell>
                  <s-table-cell>
                    {l.status === "CHECKOUT" ? (
                      <s-badge tone="info">In Checkout</s-badge>
                    ) : (
                      <s-button tone="critical" disabled={ctx.busy} onClick={() => ctx.confirmThen(`listing-${l.id}`, { intent: "cancelListing", id: l.id })}>
                        {ctx.armed === `listing-${l.id}` ? "Confirm Take Down" : "Take Down"}
                      </s-button>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-stack>
    </s-section>
  );
}

function Offers({ data, ctx }: { data: Loader; ctx: Ctx }) {
  const offers = data.offers!;
  return (
    <s-section heading={`Open Trade Offers (${offers.length})`}>
      <s-stack gap="base">
        <s-paragraph>Offers waiting on an answer. Offers expire on their own after 7 days; withdraw one only if a player asks or it breaks the rules.</s-paragraph>
        {offers.length === 0 ? (
          <s-paragraph>No open offers.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Players</s-table-header>
              <s-table-header>Cards</s-table-header>
              <s-table-header>Sent</s-table-header>
              <s-table-header>Expires</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {offers.map((t) => (
                <s-table-row key={t.id}>
                  <s-table-cell>
                    <s-stack gap="none">
                      <s-text>
                        <s-link onClick={() => ctx.go({ tab: "players", player: t.from })}>{t.from}</s-link> →{" "}
                        <s-link onClick={() => ctx.go({ tab: "players", player: t.to })}>{t.to}</s-link>
                      </s-text>
                      {t.note ? <s-text color="subdued">“{t.note}”</s-text> : null}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack gap="none">
                      <s-text>Gives: {t.gives.join(", ") || "Nothing"}</s-text>
                      <s-text>Wants: {t.gets.join(", ") || "Nothing"}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{day(t.sentAt)}</s-table-cell>
                  <s-table-cell>{day(t.expiresAt)}</s-table-cell>
                  <s-table-cell>
                    <s-button tone="critical" disabled={ctx.busy} onClick={() => ctx.confirmThen(`offer-${t.id}`, { intent: "cancelOffer", id: t.id })}>
                      {ctx.armed === `offer-${t.id}` ? "Confirm Withdraw" : "Withdraw"}
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-stack>
    </s-section>
  );
}

// ---------- History ----------

type Sale = NonNullable<Loader["activity"]>["sales"][number];
type Trade = NonNullable<Loader["activity"]>["trades"][number];

function Sales({ sales, ctx, q }: { sales: Sale[]; ctx: Ctx; q: string }) {
  const needle = q.toLowerCase();
  const shown = needle
    ? sales.filter((s) => [s.card, s.seller, s.buyer, s.orderName ?? ""].some((v) => v.toLowerCase().includes(needle)))
    : sales;
  const total = shown.filter((s) => s.payoutStatus !== "CANCELLED").reduce((n, s) => n + s.price, 0);
  return (
    <s-section heading="Sales">
      <s-stack gap="base">
        <SearchBar tab="sales" q={q} placeholder="Card, trade name or order" go={ctx.go} />
        <s-text color="subdued">
          {plural(shown.length, "sale")} · {money(total)} not counting reversed sales (latest 200)
        </s-text>
        {shown.length === 0 ? (
          <s-paragraph>No sales{q ? " match that search" : " yet"}.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Card</s-table-header>
              <s-table-header>Seller → Buyer</s-table-header>
              <s-table-header format="numeric">Price</s-table-header>
              <s-table-header>Seller Credit</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {shown.map((s) => (
                <s-table-row key={s.id}>
                  <s-table-cell>
                    <s-stack gap="none">
                      <s-text type="strong">{s.card}</s-text>
                      <s-text color="subdued">
                        {day(s.soldAt)} · {s.orderName === "Vault Credit" ? "Paid With Vault Credit" : s.orderName}
                      </s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-link onClick={() => ctx.go({ tab: "players", player: s.seller })}>{s.seller}</s-link> →{" "}
                    <s-link onClick={() => ctx.go({ tab: "players", player: s.buyer })}>{s.buyer}</s-link>
                  </s-table-cell>
                  <s-table-cell>{money(s.price)}</s-table-cell>
                  <s-table-cell>
                    <s-stack gap="none">
                      <s-badge tone={payoutTone[(s.payoutStatus ?? "HELD") as keyof typeof payoutTone] ?? "neutral"}>
                        {payoutLabel[s.payoutStatus ?? ""] ?? "—"}
                        {s.payout !== null ? ` ${money(s.payout)}` : ""}
                      </s-badge>
                      <s-text color="subdued">{s.flagReason ?? (s.payoutStatus === "HELD" ? `Pays ${day(s.payoutDueAt)}` : "")}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small">
                      {s.payoutStatus === "FLAGGED" ? (
                        <s-button disabled={ctx.busy} onClick={() => ctx.confirmThen(`release-${s.id}`, { intent: "releasePayout", id: s.id })}>
                          {ctx.armed === `release-${s.id}` ? "Confirm Release" : "Release Credit"}
                        </s-button>
                      ) : null}
                      {s.payoutStatus !== "CANCELLED" ? (
                        <s-button tone="critical" disabled={ctx.busy} onClick={() => ctx.confirmThen(`sale-${s.id}`, { intent: "reverseSale", id: s.id })}>
                          {ctx.armed === `sale-${s.id}` ? "Confirm Reverse" : "Reverse Sale"}
                        </s-button>
                      ) : null}
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-stack>
    </s-section>
  );
}

function Trades({ trades, ctx, q }: { trades: Trade[]; ctx: Ctx; q: string }) {
  const needle = q.toLowerCase();
  const shown = needle
    ? trades.filter((t) => [t.from, t.to, ...t.gave, ...t.got].some((v) => v.toLowerCase().includes(needle)))
    : trades;
  return (
    <s-section heading="Trades">
      <s-stack gap="base">
        <SearchBar tab="trades" q={q} placeholder="Card or trade name" go={ctx.go} />
        <s-text color="subdued">{plural(shown.length, "trade")} (latest 200)</s-text>
        {shown.length === 0 ? (
          <s-paragraph>No trades{q ? " match that search" : " yet"}.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Date</s-table-header>
              <s-table-header listSlot="primary">Players</s-table-header>
              <s-table-header>Cards</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {shown.map((t) => (
                <s-table-row key={t.id}>
                  <s-table-cell>{day(t.date)}</s-table-cell>
                  <s-table-cell>
                    <s-link onClick={() => ctx.go({ tab: "players", player: t.from })}>{t.from}</s-link> ⇄{" "}
                    <s-link onClick={() => ctx.go({ tab: "players", player: t.to })}>{t.to}</s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack gap="none">
                      <s-text>
                        {t.from} gave: {t.gave.join(", ") || "Nothing"}
                      </s-text>
                      <s-text>
                        {t.to} gave: {t.got.join(", ") || "Nothing"}
                      </s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {t.status === "REVERSED" ? (
                      <s-badge>Reversed</s-badge>
                    ) : (
                      <s-button tone="critical" disabled={ctx.busy} onClick={() => ctx.confirmThen(`trade-${t.id}`, { intent: "reverseTrade", id: t.id })}>
                        {ctx.armed === `trade-${t.id}` ? "Confirm Reverse" : "Reverse Trade"}
                      </s-button>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-stack>
    </s-section>
  );
}

// ---------- Players ----------

function Players({ data, ctx }: { data: Loader; ctx: Ctx }) {
  const p = data.profile;
  return (
    <>
      <s-section heading="Find A Player">
        <Form
          method="get"
          onSubmit={(e) => {
            e.preventDefault();
            const v = String(new FormData(e.currentTarget).get("player") || "").trim();
            ctx.go(v ? { tab: "players", player: v } : { tab: "players" });
          }}
        >
          <s-stack direction="inline" gap="small" alignItems="end">
            <div style={{ flex: 1, minWidth: 240 }}>
              <s-search-field name="player" label="Trade name, email or customer ID" defaultValue={data.player} />
            </div>
            <s-button type="submit" variant="primary">
              Look Up
            </s-button>
          </s-stack>
        </Form>
        {data.playerError ? <s-banner tone="critical">{data.playerError}</s-banner> : null}
      </s-section>

      {data.leaders ? (
        <s-section heading="Most Active Players (30 Days)">
          <Leaders overview={data.leaders} go={ctx.go} />
        </s-section>
      ) : null}

      {p ? <Profile p={p} ctx={ctx} /> : null}
    </>
  );
}

function Profile({ p, ctx }: { p: NonNullable<Loader["profile"]>; ctx: Ctx }) {
  const [renaming, setRenaming] = useState(false);
  const activeListings = p.listings.filter((l) => l.status === "ACTIVE" || l.status === "CHECKOUT");
  const sold = p.listings.filter((l) => l.status === "SOLD");
  const openOffers = p.trades.filter((t) => t.status === "PENDING" && !t.expired);
  return (
    <>
      <s-section heading={p.tradeName ?? "No Trade Name Yet"}>
        <s-stack gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-badge tone={p.termsVersion ? "success" : "warning"}>{p.termsVersion ? `Terms Agreed ${day(p.termsAcceptedAt)}` : "Hasn't Agreed To Terms"}</s-badge>
            <s-badge>{p.showCollection ? "Public Binder" : "Private Binder"}</s-badge>
            {p.joinedAt ? <s-badge>Joined {day(p.joinedAt)}</s-badge> : null}
            <s-link href={`shopify://admin/customers/${p.customerNumber}`} target="_blank">
              Open Customer
            </s-link>
          </s-stack>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(140px, 1fr))" gap="base">
            <Stat label="Vault Credit" value={money(p.wallet.balance)} />
            <Stat label="Cards In Vault" value={String(p.vaultCards)} hint={`${p.openToTrade} open to trade`} />
            <Stat label="For Sale" value={String(activeListings.length)} />
            <Stat label="Sold" value={String(sold.length)} />
            <Stat label="Bought" value={String(p.purchases.length)} />
            <Stat label="Trades" value={String(p.trades.filter((t) => t.status === "ACCEPTED").length)} hint={`${openOffers.length} open offers`} />
          </s-grid>
          {p.tradeName ? (
            renaming ? (
              <Form method="post" onSubmit={() => setRenaming(false)}>
                <s-stack direction="inline" gap="small" alignItems="end">
                  <input type="hidden" name="intent" value="rename" />
                  <input type="hidden" name="customerId" value={p.customerId} />
                  <s-text-field name="tradeName" label="New trade name" defaultValue={p.tradeName} />
                  <s-button type="submit" variant="primary" disabled={ctx.busy}>
                    Save Name
                  </s-button>
                  <s-button variant="tertiary" onClick={() => setRenaming(false)}>
                    Cancel
                  </s-button>
                </s-stack>
              </Form>
            ) : (
              <s-stack direction="inline">
                <s-button onClick={() => setRenaming(true)}>Change Trade Name</s-button>
              </s-stack>
            )
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Vault Credit">
        <s-stack gap="base">
          <Form method="post">
            <s-stack direction="inline" gap="small" alignItems="end">
              <input type="hidden" name="intent" value="adjust" />
              <input type="hidden" name="customer" value={p.customerId} />
              <s-number-field name="amount" label="Adjust by (negative takes credit away)" step={0.01} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <s-text-field name="reason" label="Reason (the player sees this)" />
              </div>
              <s-button type="submit" disabled={ctx.busy}>
                Adjust Vault Credit
              </s-button>
            </s-stack>
          </Form>
          {p.wallet.history.length === 0 ? (
            <s-text color="subdued">No Vault Credit history.</s-text>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>Date</s-table-header>
                <s-table-header listSlot="primary">What</s-table-header>
                <s-table-header format="numeric">Amount</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {p.wallet.history.map((h) => (
                  <s-table-row key={h.id}>
                    <s-table-cell>{day(h.at)}</s-table-cell>
                    <s-table-cell>{h.note || titleCase(h.kind.replace("_", " "))}</s-table-cell>
                    <s-table-cell>
                      <s-text tone={h.amount < 0 ? "critical" : "success"}>{h.amount < 0 ? `−${money(-h.amount)}` : `+${money(h.amount)}`}</s-text>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
          {p.wallet.codes.length ? (
            <s-stack gap="small-200">
              <s-text type="strong">Store Codes</s-text>
              {p.wallet.codes.map((c) => (
                <s-text key={c.id}>
                  {c.code} · {money(c.amount)} · {titleCase(c.status)}
                  {c.orderName ? ` on ${c.orderName}` : c.status === "ACTIVE" ? ` until ${day(c.expiresAt)}` : ""}
                </s-text>
              ))}
            </s-stack>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Listings And Purchases">
        <s-stack gap="base">
          {p.listings.length === 0 && p.purchases.length === 0 ? <s-text color="subdued">Hasn&apos;t listed or bought a card yet.</s-text> : null}
          {p.listings.length ? (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Listed Card</s-table-header>
                <s-table-header format="numeric">Price</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {p.listings.map((l) => (
                  <s-table-row key={l.id}>
                    <s-table-cell>
                      <s-stack gap="none">
                        <s-text type="strong">{l.card}</s-text>
                        <s-text color="subdued">
                          {day(l.at)}
                          {l.status === "SOLD" ? ` · bought by ${l.buyer}` : ""}
                        </s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{money(l.price)}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={l.status === "ACTIVE" ? "info" : l.status === "SOLD" ? (l.payoutStatus === "CANCELLED" ? "warning" : "success") : "neutral"}>
                        {l.status === "ACTIVE" ? "For Sale" : l.status === "CHECKOUT" ? "In Checkout" : l.status === "SOLD" ? (l.payoutStatus === "CANCELLED" ? "Sale Reversed" : "Sold") : "Taken Down"}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {l.status === "ACTIVE" ? (
                        <s-button tone="critical" disabled={ctx.busy} onClick={() => ctx.confirmThen(`listing-${l.id}`, { intent: "cancelListing", id: l.id })}>
                          {ctx.armed === `listing-${l.id}` ? "Confirm Take Down" : "Take Down"}
                        </s-button>
                      ) : null}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          ) : null}
          {p.purchases.length ? (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Bought Card</s-table-header>
                <s-table-header>From</s-table-header>
                <s-table-header format="numeric">Price</s-table-header>
                <s-table-header>Paid With</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {p.purchases.map((b) => (
                  <s-table-row key={b.id}>
                    <s-table-cell>
                      <s-stack gap="none">
                        <s-text type="strong">{b.card}</s-text>
                        <s-text color="subdued">
                          {day(b.at)}
                          {b.reversed ? " · reversed" : ""}
                        </s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{b.seller}</s-table-cell>
                    <s-table-cell>{money(b.price)}</s-table-cell>
                    <s-table-cell>{b.paidWith}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Trades And Offers">
        {p.trades.length === 0 ? (
          <s-text color="subdued">No trades or offers yet.</s-text>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Date</s-table-header>
              <s-table-header listSlot="primary">With</s-table-header>
              <s-table-header>Cards</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {p.trades.map((t) => (
                <s-table-row key={t.id}>
                  <s-table-cell>{day(t.at)}</s-table-cell>
                  <s-table-cell>
                    {t.sent ? "Sent to " : "From "}
                    {t.with}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack gap="none">
                      <s-text>Gives: {t.gave.join(", ") || "Nothing"}</s-text>
                      <s-text>Gets: {t.got.join(", ") || "Nothing"}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={tradeTone[t.status as keyof typeof tradeTone] ?? "neutral"}>{t.expired ? "Expired" : titleCase(t.status)}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {t.status === "PENDING" && !t.expired ? (
                      <s-button tone="critical" disabled={ctx.busy} onClick={() => ctx.confirmThen(`offer-${t.id}`, { intent: "cancelOffer", id: t.id })}>
                        {ctx.armed === `offer-${t.id}` ? "Confirm Withdraw" : "Withdraw"}
                      </s-button>
                    ) : t.status === "ACCEPTED" ? (
                      <s-button tone="critical" disabled={ctx.busy} onClick={() => ctx.confirmThen(`trade-${t.id}`, { intent: "reverseTrade", id: t.id })}>
                        {ctx.armed === `trade-${t.id}` ? "Confirm Reverse" : "Reverse Trade"}
                      </s-button>
                    ) : null}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </>
  );
}

// ---------- Settings ----------

function Settings({ data, busy }: { data: Loader; busy: boolean }) {
  const { settings, credit, collections } = data;
  const [filter, setFilter] = useState("");
  const shown = collections.filter((c) => c.title.toLowerCase().includes(filter.toLowerCase()));
  return (
    <>
      <s-section heading="Market Switches">
        <Form method="post">
          <s-stack gap="base">
            <input type="hidden" name="intent" value="settings" />
            <s-paragraph>
              Players trade vault cards with each other, or sell them to each other for Vault Credit. The store never buys
              cards back. Card values are never shown to players.
            </s-paragraph>
            <s-checkbox name="enabled" label="Trading on (Trade Board and offers on the storefront)" defaultChecked={settings.enabled} />
            <s-checkbox name="selling" label="Selling on (players list cards for a price; needs trading on)" defaultChecked={settings.sellingSwitch} />
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
              <s-number-field name="fee" label="Fee kept from each sale (%)" min={0} max={50} step={0.5} defaultValue={String(settings.feePercent)} />
              <s-text-field
                name="accessTag"
                label="Soft launch tag"
                details="Only customers with this tag can use Vault Market. Leave empty for everyone."
                defaultValue={settings.accessTag ?? ""}
              />
            </s-grid>
            <s-stack direction="inline" gap="small">
              <s-button type="submit" variant="primary" disabled={busy}>
                Save Settings
              </s-button>
            </s-stack>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Vault Credit">
        <Form method="post">
          <s-stack gap="base">
            <input type="hidden" name="intent" value="credit" />
            <s-paragraph>
              Sellers are paid in Vault Credit, a balance kept in this app (not Shopify store credit). Players spend it on
              other players&apos; cards, or turn it into a one-time code that only works on the collections ticked below.
              Never tick a collection that holds Mystery Packs; saving checks for that. Codes last 30 days and unused
              amounts go back to the player&apos;s balance.
            </s-paragraph>
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
              <Stat label="Outstanding Vault Credit" value={money(credit!.outstanding)} />
              <Stat label="Open Store Codes" value={String(credit!.openCodes)} />
              <Stat label="Eligible Collections" value={String(credit!.collectionIds.length)} />
            </s-grid>
            <s-search-field label="Filter collections" labelAccessibilityVisibility="exclusive" placeholder="Filter collections" value={filter} onInput={(e) => setFilter((e.currentTarget as unknown as { value: string }).value)} />
            <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid #e1e3e5", borderRadius: 8, padding: 12, display: "grid", gap: 6 }}>
              {collections.map((c) => (
                <label key={c.id} style={{ display: shown.includes(c) ? "flex" : "none", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" name="collection" value={c.id} defaultChecked={credit!.collectionIds.includes(c.id)} />
                  {c.title}
                </label>
              ))}
            </div>
            <s-checkbox name="combines" label="Codes combine with other product and order discounts" defaultChecked={credit!.combines} />
            <s-stack direction="inline">
              <s-button type="submit" disabled={busy}>
                Save Vault Credit Settings
              </s-button>
            </s-stack>
          </s-stack>
        </Form>
      </s-section>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
