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
  return auditPoolInventory(db, admin);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  try {
    const released = await repairStuckReservations(db, admin);
    return { ok: released ? `Released ${released} stuck reservation${released === 1 ? "" : "s"} back to available.` : "Nothing needed repairing." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "That didn't work. Please try again." };
  }
};

export default function InventoryCheck() {
  const { checked, issues } = useLoaderData<typeof loader>();
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
          <s-paragraph>
            Checked {checked} pool card{checked === 1 ? "" : "s"} against Shopify. A card is flagged when its available count
            is negative, or when Shopify holds more copies in reserved than the pools and open vault invoices account for.
          </s-paragraph>
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
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
              {stuck > 0 ? (
                <s-button variant="primary" disabled={busy} onClick={() => submit({}, { method: "post" })}>
                  Release {stuck} Stuck Reservation{stuck === 1 ? "" : "s"}
                </s-button>
              ) : (
                <s-paragraph>
                  These cards have no stuck reservations to release. A negative count here comes from on-hand or order
                  changes outside the app, so adjust it in Shopify.
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
