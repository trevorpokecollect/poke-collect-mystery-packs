import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { addCards, launch, poolSummary } from "../lib/series.server";
import { TIERS } from "../lib/tiers";
import { PoolError } from "../lib/pool.server";
import { packsPageUrl } from "../lib/links.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const series = await db.series.findFirst({
    where: { id: params.id, shop: session.shop },
    include: { cards: { orderBy: [{ sortOrder: "asc" }] } },
  });
  if (!series) throw new Response("Not found", { status: 404 });

  const remaining = await db.slot.groupBy({
    by: ["cardId"],
    where: { seriesId: series.id, claimed: false, voided: false },
    _count: { _all: true },
  });
  const left = new Map(remaining.map((r) => [r.cardId, r._count._all]));
  const pulls = await db.pull.findMany({
    where: { seriesId: series.id },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { slot: { include: { card: { select: { title: true, tier: true } } } } },
  });
  const summary = poolSummary(series.cards, Number(series.packPrice));

  return {
    series: {
      id: series.id,
      title: series.title,
      handle: series.handle,
      status: series.status,
      packPrice: series.packPrice.toString(),
      autoOpenDays: series.autoOpenDays,
      commitHash: series.commitHash,
    },
    cards: series.cards.map((c) => ({
      id: c.id,
      title: c.title,
      imageUrl: c.imageUrl,
      tier: c.tier,
      marketValue: c.marketValue.toString(),
      quantity: c.quantity,
      remaining: series.status === "DRAFT" ? c.quantity : (left.get(c.id) ?? 0),
    })),
    summary,
    pulls: pulls.map((p) => ({
      id: p.id,
      orderName: p.orderName,
      card: p.slot.card.title,
      tier: p.slot.card.tier,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
    })),
    oddsUrl: `/apps/packs/api/odds/${series.handle}`,
    packsPage: packsPageUrl(session.shop),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const series = await db.series.findFirst({ where: { id: params.id, shop: session.shop } });
  if (!series) throw new Response("Not found", { status: 404 });

  const form = await request.formData();
  const intent = form.get("intent");
  const editable = series.status === "DRAFT";

  try {
    switch (intent) {
      case "addCards": {
        if (!editable) return { error: "Cards can't change after launch." };
        await addCards(admin, series.id, JSON.parse(String(form.get("variantIds") || "[]")));
        return { ok: "Cards added." };
      }
      case "updateCard": {
        if (!editable) return { error: "Cards can't change after launch." };
        const tier = String(form.get("tier"));
        const marketValue = Number(form.get("marketValue"));
        const quantity = Math.floor(Number(form.get("quantity")));
        if (!Number.isFinite(marketValue) || marketValue < 0 || !(quantity >= 0)) {
          return { error: "Value and quantity must be positive numbers." };
        }
        await db.card.update({
          where: { id: String(form.get("cardId")), seriesId: series.id },
          data: { tier, marketValue, quantity },
        });
        return { ok: "Saved." };
      }
      case "removeCard": {
        if (!editable) return { error: "Cards can't change after launch." };
        await db.card.delete({ where: { id: String(form.get("cardId")), seriesId: series.id } });
        return { ok: "Removed." };
      }
      case "launch": {
        await db.card.deleteMany({ where: { seriesId: series.id, quantity: 0 } });
        const { packs } = await launch(admin, series.id);
        return { ok: `Launched with ${packs} packs.` };
      }
      case "close": {
        await db.series.update({
          where: { id: series.id },
          data: { status: "CLOSED", closedAt: new Date() },
        });
        return { ok: "Series closed. No more packs will be drawn." };
      }
      default:
        return { error: "Unknown action." };
    }
  } catch (error) {
    if (error instanceof PoolError || error instanceof Error) return { error: error.message };
    throw error;
  }
};

const money = (n: number | string) => `$${Number(n).toFixed(2)}`;
const percent = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function SeriesPage() {
  const { series, cards, summary, pulls, oddsUrl, packsPage } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const draft = series.status === "DRAFT";
  const busy = navigation.state !== "idle";

  async function pickCards() {
    const selection = await shopify.resourcePicker({ type: "variant", multiple: true });
    if (!selection?.length) return;
    submit(
      { intent: "addCards", variantIds: JSON.stringify(selection.map((v: { id: string }) => v.id)) },
      { method: "post" },
    );
  }

  function saveCard(cardId: string, row: HTMLElement) {
    const read = (name: string) =>
      (row.querySelector(`[data-field="${name}"]`) as HTMLInputElement | null)?.value ?? "";
    submit(
      { intent: "updateCard", cardId, tier: read("tier"), marketValue: read("marketValue"), quantity: read("quantity") },
      { method: "post" },
    );
  }

  return (
    <s-page heading={series.title}>
      {draft ? (
        <s-button
          slot="primary-action"
          variant="primary"
          disabled={cards.length === 0 || busy}
          onClick={() => {
            if (confirm(`Launch ${series.title}? The card list and odds are locked once packs go on sale.`)) {
              submit({ intent: "launch" }, { method: "post" });
            }
          }}
        >
          Launch series
        </s-button>
      ) : series.status === "LIVE" ? (
        <s-button
          slot="secondary-actions"
          tone="critical"
          onClick={() => {
            if (confirm("Close this series? No more packs will be drawn.")) submit({ intent: "close" }, { method: "post" });
          }}
        >
          Close series
        </s-button>
      ) : null}

      {result && "error" in result && result.error ? <s-banner tone="critical">{result.error}</s-banner> : null}
      {result && "ok" in result && result.ok ? <s-banner tone="success">{result.ok}</s-banner> : null}

      <s-section heading="Card pool">
        {draft ? (
          <s-stack gap="base">
            <s-paragraph>
              Add the cards in this series. Each card is a Shopify product variant (keep these off your Online
              Store channel). Quantity is how many copies go in the pool; odds are quantity divided by total
              packs.
            </s-paragraph>
            <s-button onClick={pickCards} {...(busy ? { loading: true } : {})}>
              Add cards
            </s-button>
          </s-stack>
        ) : null}

        {cards.length > 0 ? (
          <s-table>
            <s-table-header-row>
              <s-table-header>Card</s-table-header>
              <s-table-header>Tier</s-table-header>
              <s-table-header format="currency">Market value</s-table-header>
              <s-table-header format="numeric">Copies</s-table-header>
              <s-table-header format="numeric">Odds</s-table-header>
              {draft ? <s-table-header>{""}</s-table-header> : <s-table-header format="numeric">Left</s-table-header>}
            </s-table-header-row>
            <s-table-body>
              {cards.map((card) => (
                <s-table-row key={card.id}>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small" alignItems="center">
                      {card.imageUrl ? <s-thumbnail src={card.imageUrl} alt={card.title} size="small" /> : null}
                      <s-text>{card.title}</s-text>
                    </s-stack>
                  </s-table-cell>
                  {draft ? (
                    <>
                      <s-table-cell>
                        <s-select label="Tier" labelAccessibilityVisibility="exclusive" value={card.tier} data-field="tier">
                          {TIERS.map((t) => (
                            <s-option key={t} value={t}>
                              {t}
                            </s-option>
                          ))}
                        </s-select>
                      </s-table-cell>
                      <s-table-cell>
                        <s-money-field
                          label="Market value"
                          labelAccessibilityVisibility="exclusive"
                          value={card.marketValue}
                          data-field="marketValue"
                        />
                      </s-table-cell>
                      <s-table-cell>
                        <s-number-field
                          label="Copies"
                          labelAccessibilityVisibility="exclusive"
                          min={0}
                          value={String(card.quantity)}
                          data-field="quantity"
                        />
                      </s-table-cell>
                      <s-table-cell>{summary.packs ? percent(card.quantity / summary.packs) : "—"}</s-table-cell>
                      <s-table-cell>
                        <s-button-group>
                          <s-button
                            slot="secondary-actions"
                            onClick={(e) => saveCard(card.id, (e.currentTarget as HTMLElement).closest("s-table-row")!)}
                          >
                            Save
                          </s-button>
                          <s-button
                            slot="secondary-actions"
                            tone="critical"
                            onClick={() => submit({ intent: "removeCard", cardId: card.id }, { method: "post" })}
                          >
                            Remove
                          </s-button>
                        </s-button-group>
                      </s-table-cell>
                    </>
                  ) : (
                    <>
                      <s-table-cell>{card.tier}</s-table-cell>
                      <s-table-cell>{money(card.marketValue)}</s-table-cell>
                      <s-table-cell>{card.quantity}</s-table-cell>
                      <s-table-cell>{summary.packs ? percent(card.quantity / summary.packs) : "—"}</s-table-cell>
                      <s-table-cell>{card.remaining}</s-table-cell>
                    </>
                  )}
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        ) : null}
      </s-section>

      {!draft ? (
        <s-section heading="Recent pulls">
          {pulls.length === 0 ? (
            <s-paragraph>No packs sold yet.</s-paragraph>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>Order</s-table-header>
                <s-table-header>Card</s-table-header>
                <s-table-header>Status</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {pulls.map((p) => (
                  <s-table-row key={p.id}>
                    <s-table-cell>{p.orderName}</s-table-cell>
                    <s-table-cell>
                      {p.card} ({p.tier})
                    </s-table-cell>
                    <s-table-cell>{p.status.toLowerCase()}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-section>
      ) : null}

      <s-section slot="aside" heading="Pack economics">
        <s-stack gap="small">
          <s-text>Packs: {summary.packs}</s-text>
          <s-text>Pack price: {money(series.packPrice)}</s-text>
          <s-text>Average value per pack: {money(summary.ev)}</s-text>
          <s-text>Customer return: {percent(summary.returnRate)} of price</s-text>
          <s-text>Revenue if sold out: {money(summary.revenue)}</s-text>
          <s-text>Pool market value: {money(summary.totalValue)}</s-text>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Storefront">
        <s-stack gap="small">
          <s-paragraph>
            Customers open packs at <s-link href={packsPage} target="_blank">{packsPage}</s-link>. Unopened packs
            open automatically after {series.autoOpenDays} days.
          </s-paragraph>
          {series.commitHash ? (
            <s-paragraph>
              Fairness commitment: <s-text type="strong">{series.commitHash.slice(0, 16)}…</s-text>. Public odds feed:{" "}
              {oddsUrl}
            </s-paragraph>
          ) : null}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
