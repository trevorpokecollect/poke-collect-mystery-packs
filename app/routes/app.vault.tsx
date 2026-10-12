import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { gql } from "../lib/orders.server";
import { addVaultCardsToShipment, moveVault, recentShipments, resolveCustomer, returnShipmentToVault } from "../lib/vault.server";

// Customer service for vault shipments: put a shipment's cards back in the vault (refunding any
// shipping paid), or add cards
// the customer opened later to a paid shipment that hasn't gone out yet.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shipments = await recentShipments(db, session.shop);

  const ids = [...new Set(shipments.flatMap((s) => [s.orderId, s.draftOrderId]).filter((id): id is string => !!id))];
  const info = new Map<string, { name?: string; email?: string | null; fulfillment?: string; cancelled?: boolean }>();
  for (let i = 0; i < ids.length; i += 50) {
    const data = await gql(
      admin,
      `#graphql
        query VaultShipmentInfo($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Order { id name email displayFulfillmentStatus cancelledAt }
            ... on DraftOrder { id email }
          }
        }`,
      { ids: ids.slice(i, i + 50) },
    );
    for (const n of data.nodes as ({ id: string; name?: string; email?: string | null; displayFulfillmentStatus?: string; cancelledAt?: string | null } | null)[]) {
      if (n?.id) info.set(n.id, { name: n.name, email: n.email, fulfillment: n.displayFulfillmentStatus, cancelled: !!n.cancelledAt });
    }
  }

  return {
    shipments: shipments.map((s) => {
      const order = s.orderId ? info.get(s.orderId) : undefined;
      const unshipped = s.status === "PAID" && order?.fulfillment === "UNFULFILLED" && !order.cancelled;
      return {
        id: s.id,
        customer: order?.email || (s.draftOrderId && info.get(s.draftOrderId)?.email) || "Customer",
        cards: s.pulls.length,
        packOrders: [...new Set(s.pulls.map((p) => p.orderName))].join(", "),
        fee: Number(s.shippingFee),
        pickup: s.pickup,
        created: s.createdAt.toISOString(),
        status:
          s.status === "PENDING"
            ? "Awaiting Payment"
            : order?.cancelled
              ? "Order Cancelled"
              : order?.fulfillment === "UNFULFILLED"
                ? "Paid · Not Shipped"
                : order?.fulfillment === "FULFILLED"
                  ? s.pickup ? "Picked Up" : "Shipped"
                  : "Paid",
        orderName: order?.name ?? null,
        orderNumericId: s.orderId ? s.orderId.split("/").pop() : null,
        canReturn: s.status === "PENDING" || unshipped,
        canAdd: unshipped && s.vaultWaiting > 0,
        vaultWaiting: s.vaultWaiting,
      };
    }),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const requestId = String(form.get("requestId") || "");
  try {
    if (form.get("intent") === "return") {
      const { cards, cancelledOrder } = await returnShipmentToVault(db, admin, session.shop, requestId);
      return {
        ok: cancelledOrder
          ? `${cards} card${cards === 1 ? " is" : "s are"} back in the vault. ${cancelledOrder} was cancelled and its shipping payment refunded.`
          : `${cards} card${cards === 1 ? " is" : "s are"} back in the vault and the unpaid invoice was removed.`,
      };
    }
    if (form.get("intent") === "add") {
      const added = await addVaultCardsToShipment(db, admin, session.shop, requestId);
      return { ok: added ? `Added ${added} vault card${added === 1 ? "" : "s"} to the shipment at no charge.` : "No other cards are waiting in that customer's vault." };
    }
    if (form.get("intent") === "previewMove" || form.get("intent") === "move") {
      const from = await resolveCustomer(admin, String(form.get("from") || ""));
      const to = await resolveCustomer(admin, String(form.get("to") || ""));
      const dryRun = form.get("intent") === "previewMove";
      const moved = await moveVault(db, session.shop, from.customerId, to.customerId, { dryRun });
      const what = `${moved.cards} vault card${moved.cards === 1 ? "" : "s"} and ${moved.unopened} unopened pack${moved.unopened === 1 ? "" : "s"} from ${moved.orders} order${moved.orders === 1 ? "" : "s"}`;
      if (moved.cards + moved.unopened === 0) return { error: `${from.label} has nothing in their vault to move.` };
      return dryRun
        ? { preview: { text: `Move ${what} from ${from.label} to ${to.label}?`, from: String(form.get("from")), to: String(form.get("to")) } }
        : { ok: `Moved ${what} from ${from.label} to ${to.label}. They'll see them under My Packs when logged in.` };
    }
    return { error: "Unknown action." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "That didn't work. Please try again." };
  }
};

const tone = {
  "Awaiting Payment": "warning",
  "Paid · Not Shipped": "info",
  Shipped: "success",
  "Picked Up": "success",
  Paid: "neutral",
  "Order Cancelled": "critical",
} as const;

export default function VaultShipments() {
  const { shipments } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const submit = useSubmit();
  const busy = useNavigation().state !== "idle";
  const [armed, setArmed] = useState<string | null>(null);

  const returnToVault = (id: string) => {
    if (armed !== id) return setArmed(id);
    setArmed(null);
    submit({ intent: "return", requestId: id }, { method: "post" });
  };

  return (
    <s-page heading="Vault Shipments">
      <s-section>
        <s-stack gap="base">
          {result && "error" in result ? <s-banner tone="critical">{result.error}</s-banner> : null}
          {result && "ok" in result ? <s-banner tone="success">{result.ok}</s-banner> : null}
          {result && "preview" in result && result.preview ? (
            <s-banner tone="warning">
              <s-stack gap="small">
                <s-text>{result.preview.text}</s-text>
                <s-button
                  variant="primary"
                  disabled={busy}
                  onClick={() => submit({ intent: "move", from: result.preview!.from, to: result.preview!.to }, { method: "post" })}
                >
                  Confirm Move
                </s-button>
              </s-stack>
            </s-banner>
          ) : null}
          {armed ? (
            <s-banner tone="warning">
              Click Return To Vault again to confirm. Unpaid invoices are removed; paid orders that haven&apos;t shipped are
              cancelled in Shopify and the shipping payment is refunded, and the cards go back to the customer&apos;s vault.
            </s-banner>
          ) : null}
          <s-paragraph>
            Open and paid vault shipments, newest first. Return To Vault undoes a shipment. Add Vault Cards puts cards the
            customer opened later onto a paid shipment that hasn&apos;t shipped yet, at no extra charge.
          </s-paragraph>
          {shipments.length === 0 ? (
            <s-paragraph>No vault shipments yet.</s-paragraph>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>Customer</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header format="numeric">Cards</s-table-header>
                <s-table-header>Order</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {shipments.map((s) => (
                  <s-table-row key={s.id}>
                    <s-table-cell>
                      <s-stack gap="none">
                        <s-text type="strong">{s.customer}</s-text>
                        <s-text color="subdued">
                          {new Date(s.created).toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
                          {s.pickup ? "Local Pickup" : s.fee ? `$${s.fee.toFixed(2)} Shipping` : "Free Shipping"}
                        </s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={tone[s.status as keyof typeof tone] ?? "neutral"}>{s.status}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {s.cards}
                      {s.vaultWaiting > 0 && s.canAdd ? ` (+${s.vaultWaiting} in vault)` : ""}
                    </s-table-cell>
                    <s-table-cell>
                      {s.orderName && s.orderNumericId ? (
                        <s-link href={`shopify://admin/orders/${s.orderNumericId}`} target="_blank">
                          {s.orderName}
                        </s-link>
                      ) : (
                        <s-text color="subdued">Invoice only</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small">
                        {s.canAdd ? (
                          <s-button disabled={busy} onClick={() => submit({ intent: "add", requestId: s.id }, { method: "post" })}>
                            Add Vault Cards
                          </s-button>
                        ) : null}
                        {s.canReturn ? (
                          <s-button tone="critical" disabled={busy} onClick={() => returnToVault(s.id)}>
                            {armed === s.id ? "Confirm Return" : "Return To Vault"}
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
      <s-section heading="Move A Vault">
        <s-stack gap="base">
          <s-paragraph>
            Moves a customer&apos;s vault cards and unopened packs to another customer, e.g. when they bought under a
            different email. Enter an email address or a customer ID for each. Cards already shipping stay put.
          </s-paragraph>
          <s-text-field label="From (email or customer ID)" data-move="from" />
          <s-text-field label="To (email or customer ID)" data-move="to" />
          <s-button
            disabled={busy}
            onClick={(e) => {
              const section = (e.currentTarget as HTMLElement).closest("s-section")!;
              const read = (name: string) => (section.querySelector(`[data-move="${name}"]`) as HTMLInputElement | null)?.value ?? "";
              submit({ intent: "previewMove", from: read("from"), to: read("to") }, { method: "post" });
            }}
          >
            Preview Move
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
