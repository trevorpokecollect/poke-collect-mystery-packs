import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
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
  updateMarketSettings,
} from "../lib/market.server";

// Vault Marketplace: the on/off switches, the fee, and customer service for trades and sales
// between players (reverse a trade or sale, hold or release a seller's store credit).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const [settings, activity] = await Promise.all([marketSettings(db, session.shop), marketActivity(db, session.shop)]);
  const row = await db.marketSettings.findUnique({ where: { shop: session.shop } });
  const collections = await gql(admin, `#graphql
    query CreditCollections { collections(first: 250, sortKey: TITLE) { nodes { id title } } }`)
    .then((d) => d.collections.nodes as { id: string; title: string }[])
    .catch(() => [] as { id: string; title: string }[]);
  const credit = {
    collectionIds: row?.creditCollectionIds ?? [],
    combines: row?.creditCombines ?? false,
    outstanding: Number((await db.creditTxn.aggregate({ where: { shop: session.shop }, _sum: { amount: true } }))._sum.amount ?? 0),
    openCodes: await db.creditCode.count({ where: { shop: session.shop, status: "ACTIVE" } }),
  };
  return {
    previewUrl: `https://${session.shop}/apps/packs/market?demo=${demoToken(session.shop)}`,
    settings: { ...settings, sellingSwitch: row?.sellingEnabled ?? false },
    collections,
    credit, activity: JSON.parse(JSON.stringify(activity)) as typeof activity };
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
        await adjustCredit(db, shop, who.customerId, Number(form.get("amount")), String(form.get("reason") || ""));
        return { ok: `Adjusted ${who.label}'s Vault Credit by $${Number(form.get("amount")).toFixed(2)}.` };
      }
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
const payoutLabel: Record<string, string> = { HELD: "Held", PAYING: "Paying", PAID: "Paid", FLAGGED: "Flagged", CANCELLED: "Cancelled" };
const payoutTone = { HELD: "info", PAYING: "info", PAID: "success", FLAGGED: "critical", CANCELLED: "neutral" } as const;

export default function Marketplace() {
  const { settings, activity, previewUrl, collections, credit } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const submit = useSubmit();
  const busy = useNavigation().state !== "idle";
  const [armed, setArmed] = useState<string | null>(null);
  const confirmThen = (key: string, data: Record<string, string>) => {
    if (armed !== key) return setArmed(key);
    setArmed(null);
    submit(data, { method: "post" });
  };

  return (
    <s-page heading="Vault Marketplace">
      <s-section heading="Settings">
        <form method="post">
          <s-stack gap="base">
            <input type="hidden" name="intent" value="settings" />
            <s-paragraph>
              Players trade vault cards with each other, or sell them to each other for Vault Credit. The store never buys
              cards back. Card values are never shown to players.
            </s-paragraph>
            <s-checkbox name="enabled" label="Trading on (Trade Board and offers on the storefront)" defaultChecked={settings.enabled} />
            <s-checkbox name="selling" label="Selling on (players list cards for a price; needs trading on)" defaultChecked={settings.sellingSwitch} />
            <s-number-field name="fee" label="Fee kept from each sale (%)" min={0} max={50} step={0.5} defaultValue={String(settings.feePercent)} />
            <s-stack direction="inline" gap="small">
              <s-button type="submit" variant="primary" disabled={busy}>
                Save Settings
              </s-button>
              <s-button href={previewUrl} target="_blank">
                Preview Marketplace
              </s-button>
            </s-stack>
          </s-stack>
        </form>
      </s-section>

      <s-section heading="Vault Credit">
        <form method="post">
          <s-stack gap="base">
            <input type="hidden" name="intent" value="credit" />
            <s-paragraph>
              Sellers are paid in Vault Credit, a balance kept in this app (not Shopify store credit). Players spend it on
              other players&apos; cards, or turn it into a one-time code that only works on the collections ticked below.
              Never tick a collection that holds Mystery Packs; saving checks for that. Codes last 30 days and unused
              amounts go back to the player&apos;s balance.
            </s-paragraph>
            <s-text>
              Outstanding Vault Credit: ${credit.outstanding.toFixed(2)} · Open codes: {credit.openCodes}
            </s-text>
            <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid #e1e3e5", borderRadius: 8, padding: 12, display: "grid", gap: 6 }}>
              {collections.map((c) => (
                <label key={c.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" name="collection" value={c.id} defaultChecked={credit.collectionIds.includes(c.id)} />
                  {c.title}
                </label>
              ))}
            </div>
            <s-checkbox name="combines" label="Codes combine with other product and order discounts" defaultChecked={credit.combines} />
            <s-button type="submit" disabled={busy}>
              Save Vault Credit Settings
            </s-button>
          </s-stack>
        </form>
        <form method="post">
          <s-stack gap="base">
            <input type="hidden" name="intent" value="adjust" />
            <s-heading>Adjust A Balance</s-heading>
            <s-text-field name="customer" label="Customer (email or customer ID)" />
            <s-number-field name="amount" label="Amount (negative takes credit away)" step={0.01} />
            <s-text-field name="reason" label="Reason" />
            <s-button type="submit" disabled={busy}>
              Adjust Vault Credit
            </s-button>
          </s-stack>
        </form>
      </s-section>

      <s-section>
        <s-stack gap="base">
          {result && "error" in result ? <s-banner tone="critical">{result.error}</s-banner> : null}
          {result && "ok" in result ? <s-banner tone="success">{result.ok}</s-banner> : null}
          {armed ? <s-banner tone="warning">Click again to confirm.</s-banner> : null}
          <s-paragraph>{activity.traders} player{activity.traders === 1 ? " has" : "s have"} picked a trade name.</s-paragraph>
        </s-stack>
      </s-section>

      {activity.flagged.length ? (
        <s-section heading="Refunds On Traded Cards">
          <s-paragraph>
            These pack orders were refunded after the card was traded or sold to another player. The card stayed with its
            new owner; settle the refund as money only, then mark it reviewed.
          </s-paragraph>
          <s-table>
            <s-table-header-row>
              <s-table-header>Card</s-table-header>
              <s-table-header>Pack Order</s-table-header>
              <s-table-header>Owner Now</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {activity.flagged.map((f) => (
                <s-table-row key={f.pullId}>
                  <s-table-cell>{f.card}</s-table-cell>
                  <s-table-cell>{f.orderName}</s-table-cell>
                  <s-table-cell>{f.owner}</s-table-cell>
                  <s-table-cell>
                    <s-button disabled={busy} onClick={() => submit({ intent: "clearFlag", id: f.pullId }, { method: "post" })}>
                      Mark Reviewed
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      ) : null}

      <s-section heading="Sales">
        {activity.sales.length === 0 ? (
          <s-paragraph>No sales yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Card</s-table-header>
              <s-table-header>Seller → Buyer</s-table-header>
              <s-table-header format="numeric">Price</s-table-header>
              <s-table-header>Seller Credit</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {activity.sales.map((s) => (
                <s-table-row key={s.id}>
                  <s-table-cell>
                    <s-stack gap="none">
                      <s-text type="strong">{s.card}</s-text>
                      <s-text color="subdued">
                        {day(s.soldAt)} · {s.orderName}
                      </s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {s.seller} → {s.buyer}
                  </s-table-cell>
                  <s-table-cell>${s.price.toFixed(2)}</s-table-cell>
                  <s-table-cell>
                    <s-stack gap="none">
                      <s-badge tone={payoutTone[(s.payoutStatus ?? "HELD") as keyof typeof payoutTone] ?? "neutral"}>
                        {payoutLabel[s.payoutStatus ?? ""] ?? "—"}
                        {s.payout !== null ? ` $${s.payout.toFixed(2)}` : ""}
                      </s-badge>
                      <s-text color="subdued">{s.payoutStatus === "HELD" ? `Pays ${day(s.payoutDueAt)}` : (s.flagReason ?? "")}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small">
                      {s.payoutStatus === "FLAGGED" ? (
                        <s-button disabled={busy} onClick={() => confirmThen(`release-${s.id}`, { intent: "releasePayout", id: s.id })}>
                          {armed === `release-${s.id}` ? "Confirm Release" : "Release Credit"}
                        </s-button>
                      ) : null}
                      {s.payoutStatus !== "PAID" && s.payoutStatus !== "CANCELLED" ? (
                        <s-button tone="critical" disabled={busy} onClick={() => confirmThen(`sale-${s.id}`, { intent: "reverseSale", id: s.id })}>
                          {armed === `sale-${s.id}` ? "Confirm Reverse" : "Reverse Sale"}
                        </s-button>
                      ) : null}
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Trades">
        {activity.trades.length === 0 ? (
          <s-paragraph>No trades yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Date</s-table-header>
              <s-table-header>Players</s-table-header>
              <s-table-header>Cards</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {activity.trades.map((t) => (
                <s-table-row key={t.id}>
                  <s-table-cell>{day(t.date)}</s-table-cell>
                  <s-table-cell>
                    {t.from} ⇄ {t.to}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack gap="none">
                      <s-text>
                        {t.from} gave: {t.gave.join(", ")}
                      </s-text>
                      <s-text>
                        {t.to} gave: {t.got.join(", ")}
                      </s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {t.status === "REVERSED" ? (
                      <s-badge>Reversed</s-badge>
                    ) : (
                      <s-button tone="critical" disabled={busy} onClick={() => confirmThen(`trade-${t.id}`, { intent: "reverseTrade", id: t.id })}>
                        {armed === `trade-${t.id}` ? "Confirm Reverse" : "Reverse Trade"}
                      </s-button>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
