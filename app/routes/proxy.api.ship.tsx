import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { PoolError } from "../lib/pool.server";
import { json, proxyContext } from "../lib/proxy.server";
import { cancelShipment, PICKUP_LOCATION, requestShipment } from "../lib/vault.server";

// "Ship my cards": starts a shipment for the viewer's vault cards and returns the invoice link
// where they pay the shipping fee (or check out free on large shipments). { pullIds } limits it
// to the cards the customer picked; without it the whole vault goes.
// With { pickup: true } the cards are set aside on a free local pickup order instead.
// With { cancel: true } the open (unpaid) shipping invoice is cancelled and the cards stay in the vault.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, viewer, admin } = await proxyContext(request);
  if (!viewer) return json({ error: "Log in to ship your cards." }, 401);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!admin) return json({ error: "Shipping isn't available right now. Please try again." }, 503);

  try {
    const body = (await request.json().catch(() => ({}))) as { pickup?: boolean; pullIds?: unknown; cancel?: boolean };
    if (body.cancel === true) return json({ cancelled: true, ...(await cancelShipment(db, admin, shop, viewer)) });
    const pullIds = Array.isArray(body.pullIds) ? body.pullIds.filter((id): id is string => typeof id === "string").slice(0, 1000) : undefined;
    const { invoiceUrl, pickupOrder } = await requestShipment(db, admin, shop, viewer, { pickup: body.pickup === true, pullIds });
    return json(pickupOrder ? { pickupOrder, pickupAddress: PICKUP_LOCATION.address, pickupHours: PICKUP_LOCATION.hours } : { invoiceUrl });
  } catch (error) {
    if (error instanceof PoolError) return json({ error: error.message }, 400);
    console.error("Ship request failed", error);
    return json({ error: "Couldn't start your shipment. Please try again." }, 500);
  }
};
