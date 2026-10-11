import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  createSeries,
  addCards,
  autoBuildPool,
  launch,
  poolSummary,
  setPackStock,
  seriesTierRules,
  syncDraftPackPrice,
  updateTierRules,
} from "../lib/series.server";
import { releaseUnneeded } from "../lib/inventory.server";
import { TIERS } from "../lib/tiers";
import { PoolError } from "../lib/pool.server";
import { packsPageUrl, storefrontBase } from "../lib/links.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const series = await db.series.findFirst({
    where: { id: params.id, shop: session.shop },
    include: { cards: { orderBy: [{ sortOrder: "asc" }] } },
  });
  if (!series) throw new Response("Not found", { status: 404 });
  const packPrice = (await syncDraftPackPrice(admin, series)) ?? series.packPrice.toString();

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
  const summary = poolSummary(series.cards, Number(packPrice), series.cardsPerPack);
  const tierRules = seriesTierRules(series);
  const tierCounts = new Map<string, number>();
  for (const c of series.cards) tierCounts.set(c.tier, (tierCounts.get(c.tier) ?? 0) + c.quantity);
  const build = (series.buildRules ?? {}) as Partial<Record<string, string | number>>;
  // A link can carry pool-rule overrides (e.g. ?targetAverage=10.99) and show a one-click
  // "Rebuild pool" in the title bar for a draft.
  const url = new URL(request.url);
  const BUILD_KEYS = ["count", "minValue", "maxValue", "targetAverage", "minHits", "hitValue", "productType", "condition", "language"];
  const buildOverrides = Object.fromEntries(BUILD_KEYS.filter((k) => url.searchParams.has(k)).map((k) => [k, url.searchParams.get(k) ?? ""]));
  // ?tiers=Poke:0,Great:5.01,Ultra:10.01,Master:25.01 shows a one-click "Apply Tiers" for a draft.
  const tierOverride = (url.searchParams.get("tiers") ?? "")
    .split(",")
    .map((part) => part.split(":"))
    .filter(([name, min]) => name?.trim() && Number.isFinite(Number(min)))
    .map(([name, min]) => ({ name: name.trim(), min: Number(min) }));

  return {
    series: {
      id: series.id,
      title: series.title,
      handle: series.handle,
      status: series.status,
      packPrice,
      autoOpenDays: series.autoOpenDays,
      commitHash: series.commitHash,
      reserveInventory: series.reserveInventory,
    },
    tierRules,
    buildOverrides,
    tierOverride,
    tierNames: series.tierRules ? tierRules.map((t) => t.name) : [...TIERS],
    tierCounts: [...tierCounts.entries()],
    buildDefaults: {
      count: String(build.count ?? 100 * series.cardsPerPack),
      minValue: String(build.minValue ?? 2),
      maxValue: String(build.maxValue ?? 50),
      // Default to a 100% return: the average card value equals the pack price.
      // Per card: a multi-card pack spreads the pack price across its cards.
      targetAverage: String(build.targetAverage ?? (Number(packPrice) / series.cardsPerPack).toFixed(2)),
      minHits: String(build.minHits ?? 0),
      hitValue: String(build.hitValue ?? 5),
      productType: String(build.productType ?? "Pokemon Single"),
      condition: String(build.condition ?? "Near Mint"),
      language: String(build.language ?? "English"),
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
    packsPage: packsPageUrl(await storefrontBase(admin, session.shop)),
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
      case "autoBuild": {
        if (!editable) return { error: "Cards can't change after launch." };
        const num = (name: string) => Number(form.get(name));
        const count = await autoBuildPool(admin, session.shop, series.id, {
          count: Math.floor(num("count")),
          minValue: num("minValue"),
          maxValue: num("maxValue"),
          targetAverage: num("targetAverage"),
          minHits: Math.floor(num("minHits") || 0),
          hitValue: num("hitValue") || undefined,
          productType: String(form.get("productType") || "").trim(),
          condition: String(form.get("condition") || "").trim(),
          language: String(form.get("language") || "").trim(),
        });
        return { ok: `Built a pool of ${count} cards from your inventory.` };
      }
      case "saveTiers": {
        if (!editable) return { error: "Tiers can't change after launch." };
        await updateTierRules(series.id, JSON.parse(String(form.get("tiers") || "[]")));
        return { ok: "Tiers saved and applied to every card." };
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
        // Stop selling packs, then hand unpulled cards back to normal stock.
        await setPackStock(admin, series.packVariantId, 0, `close-${series.id}`);
        const released = await releaseUnneeded(db, admin, series.id);
        return {
          ok: `Series closed. No more packs will be drawn.${released ? ` ${released} unpulled card${released === 1 ? " is" : "s are"} back on sale.` : ""}`,
        };
      }
      case "rerun": {
        // Same name, pack product, tiers and pool rules, with a fresh pool built from current inventory.
        if (series.status !== "CLOSED") return { error: "Close this series before running it again." };
        const next = await createSeries(admin, session.shop, {
          title: series.title,
          packVariantId: series.packVariantId,
          autoOpenDays: series.autoOpenDays,
        });
        if (series.tierRules) {
          await db.series.update({ where: { id: next.id }, data: { tierRules: series.tierRules as object } });
        }
        if (series.buildRules) {
          await autoBuildPool(admin, session.shop, next.id, series.buildRules as unknown as Parameters<typeof autoBuildPool>[3]);
        }
        return redirect(`/app/series/${next.id}`);
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
  const { series, cards, summary, pulls, oddsUrl, packsPage, tierRules, tierNames, tierCounts, buildDefaults, buildOverrides, tierOverride } =
    useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const draft = series.status === "DRAFT";
  const busy = navigation.state !== "idle";
  // Two-click confirmation instead of window.confirm(), which some embedded browsers block.
  const [armed, setArmed] = useState<{ key: string; message: string } | null>(null);
  function confirmThen(key: string, message: string, run: () => void) {
    if (armed?.key === key) {
      setArmed(null);
      run();
    } else {
      setArmed({ key, message });
    }
  }

  async function pickCards() {
    const selection = await shopify.resourcePicker({ type: "variant", multiple: true });
    if (!selection?.length) return;
    submit(
      { intent: "addCards", variantIds: JSON.stringify(selection.map((v: { id: string }) => v.id)) },
      { method: "post" },
    );
  }

  function autoBuild(form: HTMLElement) {
    const read = (name: string) =>
      (form.querySelector(`[data-build="${name}"]`) as HTMLInputElement | null)?.value ?? "";
    const fields = ["count", "minValue", "maxValue", "targetAverage", "minHits", "hitValue", "productType", "condition", "language"] as const;
    const values = Object.fromEntries(fields.map((f) => [f, read(f)]));
    const run = () => submit({ intent: "autoBuild", ...values }, { method: "post" });
    if (cards.length > 0) confirmThen("autoBuild", "Replace the current card list with a new pool from your inventory? Click Build pool again to confirm.", run);
    else run();
  }

  function saveTiers(form: HTMLElement) {
    const rows = Array.from(form.querySelectorAll("[data-tier-row]"));
    const tiers = rows
      .map((row) => ({
        name: (row.querySelector('[data-tier="name"]') as HTMLInputElement | null)?.value.trim() ?? "",
        min: (row.querySelector('[data-tier="min"]') as HTMLInputElement | null)?.value ?? "",
      }))
      .filter((t) => t.name !== "")
      .map((t) => ({ name: t.name, min: Number(t.min || 0) }));
    submit({ intent: "saveTiers", tiers: JSON.stringify(tiers) }, { method: "post" });
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
      {draft && Object.keys(buildOverrides).length > 0 ? (
        <s-button
          slot="secondary-actions"
          disabled={busy}
          onClick={() => submit({ intent: "autoBuild", ...buildDefaults, ...buildOverrides }, { method: "post" })}
        >
          Rebuild Pool ({Object.entries(buildOverrides).map(([k, v]) => `${k} ${v}`).join(", ")})
        </s-button>
      ) : null}
      {draft && tierOverride.length > 0 ? (
        <s-button
          slot="secondary-actions"
          disabled={busy}
          onClick={() => submit({ intent: "saveTiers", tiers: JSON.stringify(tierOverride) }, { method: "post" })}
        >
          Apply Tiers ({tierOverride.map((t) => `${t.name} $${t.min}+`).join(", ")})
        </s-button>
      ) : null}
      {draft ? (
        <s-button
          slot="primary-action"
          variant="primary"
          disabled={cards.length === 0 || busy}
          onClick={() => {
            const reserveNote = series.reserveInventory
              ? " Every card in the pool is reserved in your inventory, so it can only be won from a pack."
              : "";
            confirmThen(
              "launch",
              `Launch ${series.title}? The card list and odds are locked once packs go on sale.${reserveNote} Click Launch series again to confirm.`,
              () => submit({ intent: "launch" }, { method: "post" }),
            );
          }}
        >
          Launch series
        </s-button>
      ) : series.status === "LIVE" ? (
        <s-button
          slot="secondary-actions"
          tone="critical"
          onClick={() => {
            const releaseNote = series.reserveInventory ? " Unpulled cards go back on sale in your store." : "";
            confirmThen(
              "close",
              `Close this series? No more packs will be drawn.${releaseNote} Click Close series again to confirm.`,
              () => submit({ intent: "close" }, { method: "post" }),
            );
          }}
        >
          Close series
        </s-button>
      ) : series.status === "CLOSED" ? (
        <s-button
          slot="primary-action"
          variant="primary"
          disabled={busy}
          onClick={() =>
            confirmThen(
              "rerun",
              `Start a new "${series.title}" with the same pack, tiers and pool rules? A fresh pool is built from your current inventory as a draft, so you can review it before launching. Click Run Again to confirm.`,
              () => submit({ intent: "rerun" }, { method: "post" }),
            )
          }
        >
          Run Again
        </s-button>
      ) : null}

      {armed ? (
        <s-banner tone="warning" heading="Confirm">
          {armed.message}
          <s-button slot="secondary-actions" onClick={() => setArmed(null)}>Cancel</s-button>
        </s-banner>
      ) : null}
      {result && "error" in result && result.error ? <s-banner tone="critical">{result.error}</s-banner> : null}
      {result && "ok" in result && result.ok ? <s-banner tone="success">{result.ok}</s-banner> : null}

      {draft ? (
        <s-section heading="Auto-build from inventory">
          <s-stack gap="base">
            <s-paragraph>
              Picks cards from your in-stock inventory so the average value per pack matches your target: one copy
              of each card, or up to 3 copies in pools over 50 cards. Building again gives a different mix. At launch the cards are reserved in Shopify, so they
              can only be won from a pack; closing the series puts unpulled cards back on sale.
            </s-paragraph>
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
              <s-number-field label="Cards in pool" min={1} max={1000} value={buildDefaults.count} data-build="count" />
              <s-money-field label="Lowest card value" value={buildDefaults.minValue} data-build="minValue" />
              <s-money-field label="Highest card value" value={buildDefaults.maxValue} data-build="maxValue" />
              <s-money-field label="Target average value" value={buildDefaults.targetAverage} data-build="targetAverage" />
              <s-number-field
                label="Minimum hits"
                details="At least this many cards worth the hit value or more"
                min={0}
                max={1000}
                value={buildDefaults.minHits}
                data-build="minHits"
              />
              <s-money-field label="Hit value" value={buildDefaults.hitValue} data-build="hitValue" />
              <s-text-field label="Product type" value={buildDefaults.productType} data-build="productType" />
              <s-text-field
                label="Condition"
                details="Leave blank for any condition"
                value={buildDefaults.condition}
                data-build="condition"
              />
              <s-text-field
                label="Language"
                details="Matches the Language tag from StorePass. Separate several with commas (English, Japanese), or leave blank for any language"
                value={buildDefaults.language}
                data-build="language"
              />
            </s-grid>
            <s-button
              variant="primary"
              {...(busy ? { loading: true } : {})}
              onClick={(e) => autoBuild((e.currentTarget as HTMLElement).closest("s-section")!)}
            >
              {cards.length > 0 ? "Rebuild pool" : "Build pool"}
            </s-button>
          </s-stack>
        </s-section>
      ) : null}

      {draft ? (
        <s-section heading="Tiers">
          <s-stack gap="base">
            <s-paragraph>
              Each card gets the highest tier its value reaches. Customers see the tier, never the value. Clear a
              name to remove a tier.
            </s-paragraph>
            {[...tierRules, { name: "", min: 0 }].map((t, i) => (
              <s-stack key={`${t.name}-${i}`} direction="inline" gap="base" data-tier-row="">
                <s-text-field
                  label="Tier name"
                  labelAccessibilityVisibility={i === 0 ? "visible" : "exclusive"}
                  value={t.name}
                  placeholder="Add a tier"
                  data-tier="name"
                />
                <s-money-field
                  label="Starts at"
                  labelAccessibilityVisibility={i === 0 ? "visible" : "exclusive"}
                  value={t.name ? String(t.min) : ""}
                  data-tier="min"
                />
              </s-stack>
            ))}
            <s-button onClick={(e) => saveTiers((e.currentTarget as HTMLElement).closest("s-section")!)}>
              Save tiers
            </s-button>
          </s-stack>
        </s-section>
      ) : null}

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
                          {tierNames.map((t) => (
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
          <s-text>Packs: {summary.packs}{summary.cardsPerPack > 1 ? ` (${summary.cardsPerPack} cards each, ${summary.cardCount} cards)` : ""}</s-text>
          <s-text>Pack price: {money(series.packPrice)}</s-text>
          <s-text>Average value per pack: {money(summary.ev)}</s-text>
          <s-text>Customer return: {percent(summary.returnRate)} of price</s-text>
          <s-text>Revenue if sold out: {money(summary.revenue)}</s-text>
          <s-text>Pool market value: {money(summary.totalValue)}</s-text>
          {tierCounts.length > 0 ? (
            <s-text>
              Tiers: {tierCounts.map(([tier, n]) => `${tier} ${n}`).join(" · ")}
            </s-text>
          ) : null}
          {series.reserveInventory ? (
            <s-text>Cards are reserved from your store inventory while the series is live.</s-text>
          ) : null}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Storefront">
        <s-stack gap="small">
          <s-paragraph>
            Customers open packs at <s-link href={packsPage} target="_blank">{packsPage}</s-link>. Unopened packs
            open automatically after {series.autoOpenDays === 1 ? "1 day" : `${series.autoOpenDays} days`}.
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
