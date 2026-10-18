import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
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
  const { session } = await authenticate.admin(request);
  const [settings, activity] = await Promise.all([marketSettings(db, session.shop), marketActivity(db, session.shop)]);
  const row = await db.marketSettings.findUnique({ where: { shop: session.shop } });
  return { settings: { ...settings, sellingSwitch: row?.sellingEnabled ?? false }, activity: JSON.parse(JSON.stringify(activity)) as typeof activity };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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
      case "reverseTrade":
        await reverseTrade(db, shop, id);
        return { ok: "Trade reversed. Every card is back with its original owner." };
      case "reverseSale":
        await reverseSale(db, shop, id);
        return { ok: "Sale reversed. The card is back with the seller and their store credit was cancelled. Refund the buyer in Shopify if you haven't." };
      case "releasePayout":
        await releaseFlaggedPayout(db, shop, id);
        return { ok: "The seller's store credit will be paid on the next run once the hold has passed." };
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
  const { settings, activity } = useLoaderData<typeof loader>();
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
              Players trade vault cards with each other, or sell them to each other for store credit. The store never buys
              cards back. Card values are never shown to players.
            </s-paragraph>
            <s-checkbox name="enabled" label="Trading on (Trade Board and offers on the storefront)" defaultChecked={settings.enabled} />
            <s-checkbox name="selling" label="Selling on (players list cards for a price; needs trading on)" defaultChecked={settings.sellingSwitch} />
            <s-number-field name="fee" label="Fee kept from each sale (%)" min={0} max={50} step={0.5} defaultValue={String(settings.feePercent)} />
            <s-button type="submit" variant="primary" disabled={busy}>
              Save Settings
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
