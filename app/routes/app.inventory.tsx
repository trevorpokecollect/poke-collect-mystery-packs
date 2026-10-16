import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { auditPoolInventory, repairStuckReservations } from "../lib/inventory.server";

// Inventory check: every pool card's Shopify counts against what the app expects to be reserved,
// so a copy can't be held for a pack and committed to an order at the same time unnoticed.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  // ?release=<inventory item number> releases one card's stuck reservation, like the row button.
  const release = new URL(request.url).searchParams.get("release");
  const released = release ? await repairStuckReservations(db, admin, `gid://shopify/InventoryItem/${release.replace(/\D/g, "")}`) : null;
  return { ...(await auditPoolInventory(db, admin)), released };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  try {
    const itemId = String((await request.formData()).get("inventoryItemId") || "") || undefined;
    const released = await repairStuckReservations(db, admin, itemId);
    return { ok: released ? `Released ${released} stuck reservation${released === 1 ? "" : "s"} back to available.` : "Nothing needed repairing." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "That didn't work. Please try again." };
  }
};

export default function InventoryCheck() {
  const { checked, issues, released, unheldVaultCards } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const submit = useSubmit();
  const busy = useNavigation().state !== "idle";
  const stuck = issues.reduce((n, i) => n + i.stuck, 0);

  return (
    <s-page heading="Inventory Check">
      <s-section>
        <s-stack gap="base">
          {result && "error" in result ? <s-banner tone="critical">{result.error}</s-banner> : null}
          {result && "ok" in result ? <s-banner tone="success">{result.ok}</s-banner> : null}
          {released !== null ? (
            <s-banner tone={released ? "success" : "info"}>
              {released ? `Released ${released} stuck reservation${released === 1 ? "" : "s"} back to available.` : "That card had nothing to release."}
            </s-banner>
          ) : null}
          <s-paragraph>
            Checked {checked} pool card{checked === 1 ? "" : "s"} against Shopify. A card is flagged when its available count
            is negative, when Shopify holds more copies in reserved than the pools and open vault invoices account for, or
            when it holds fewer (Short), meaning a copy owed to a pack could also sell.
          </s-paragraph>
          {unheldVaultCards.length ? (
            <s-banner tone="warning" heading={`${unheldVaultCards.length} vault card${unheldVaultCards.length === 1 ? " isn't" : "s aren't"} held in inventory`}>
              The return guard couldn&apos;t re-reserve these because Shopify showed no available copy. Check the shelf, then
              adjust stock in Shopify: {unheldVaultCards.map((c) => `${c.title} (${c.orderName})`).join(", ")}.
            </s-banner>
          ) : null}
          {issues.length === 0 ? (
            <s-banner tone="success">Every pool card matches Shopify. Nothing is negative.</s-banner>
          ) : (
            <>
              <s-table>
                <s-table-header-row>
                  <s-table-header>Card</s-table-header>
                  <s-table-header format="numeric">On Hand</s-table-header>
                  <s-table-header format="numeric">Reserved</s-table-header>
                  <s-table-header format="numeric">Expected Reserved</s-table-header>
                  <s-table-header format="numeric">Committed</s-table-header>
                  <s-table-header format="numeric">Available</s-table-header>
                  <s-table-header>Fix</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {issues.map((i) => (
                    <s-table-row key={`${i.inventoryItemId}|${i.locationId}`}>
                      <s-table-cell>{i.title}</s-table-cell>
                      <s-table-cell>{i.onHand}</s-table-cell>
                      <s-table-cell>{i.reserved}</s-table-cell>
                      <s-table-cell>{i.expectedReserved}</s-table-cell>
                      <s-table-cell>{i.committed}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={i.available < 0 ? "critical" : "warning"}>{i.available}</s-badge>
                      </s-table-cell>
                      <s-table-cell>
                        {i.stuck > 0 ? (
                          <s-button disabled={busy} onClick={() => submit({ inventoryItemId: i.inventoryItemId }, { method: "post" })}>
                            Release {i.stuck}
                          </s-button>
                        ) : i.short > 0 ? (
                          <s-badge tone="critical">Short {i.short}</s-badge>
                        ) : null}
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
              {stuck > 0 ? (
                <s-button variant="primary" disabled={busy} onClick={() => submit({}, { method: "post" })}>
                  Release All {stuck} Stuck Reservation{stuck === 1 ? "" : "s"}
                </s-button>
              ) : (
                <s-paragraph>
                  These cards have no stuck reservations to release. A negative count or a Short card comes from on-hand,
                  order or reservation changes outside the app, so adjust it in Shopify.
                </s-paragraph>
              )}
            </>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
