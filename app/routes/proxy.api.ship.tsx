import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { PoolError } from "../lib/pool.server";
import { json, proxyContext } from "../lib/proxy.server";
import { isCardbit } from "../lib/cardbit.server";
import { guardRequest, shipHold } from "../lib/cardbit-guard.server";
import { parcelAddress, quoteParcel } from "../lib/cardbit-shipping.server";
import { vaultedPulls, cancelShipment, PICKUP_LOCATION, requestShipment } from "../lib/vault.server";

// "Ship my cards": starts a shipment for the viewer's vault cards and returns the invoice link
// where they pay the shipping fee (or check out free on large shipments). { pullIds } limits it
// to the cards the customer picked; without it the whole vault goes.
// With { pickup: true } the cards are set aside on a free local pickup order instead.
// With { cancel: true } the open (unpaid) shipping invoice is cancelled and the cards stay in the vault.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, viewer, admin } = await proxyContext(request);
  if (!viewer || (isCardbit(shop) && !viewer.customerId)) return json({ error: "Log in to ship your cards." }, 401);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!admin) return json({ error: "Shipping isn't available right now. Please try again." }, 503);

  try {
    const body = (await request.json().catch(() => ({}))) as { pickup?: boolean; pullIds?: unknown; cancel?: boolean; quote?: boolean; address?: unknown; quoteKey?: string };
    const action = body.cancel === true ? "ship-cancel" : body.quote === true ? "ship-quote" : "ship";
    const refused = await guardRequest(request, { db, shop, customerId: viewer.customerId, action, admin });
    if (refused) return refused;
    if (action === "ship" && viewer.customerId) {
      const held = await shipHold(db, shop, viewer.customerId, admin);
      if (held) return held;
    }
    if (body.cancel === true) return json({ cancelled: true, ...(await cancelShipment(db, admin, shop, viewer)) });
    const pullIds = Array.isArray(body.pullIds) ? body.pullIds.filter((id): id is string => typeof id === "string").slice(0, 1000) : undefined;
    let destination;
    if (isCardbit(shop)) {
      if (body.pickup) throw new PoolError("Cardbit ships to your selected destination.");
      if (!pullIds?.length || !Array.isArray(body.pullIds) || body.pullIds.length !== pullIds.length || new Set(pullIds).size !== pullIds.length)
        throw new PoolError("Select one or more individual cards.");
      const address = parcelAddress(body.address);
      if (body.quote === true) {
        const ids = new Set(pullIds);
        const cards = (await vaultedPulls(db, shop, viewer)).filter(p => ids.has(p.id));
        if (cards.length !== ids.size) throw new PoolError("A selected card is no longer available.");
        return json({ rates: await quoteParcel(admin, shop, viewer.customerId!, cards, address) });
      }
      if (typeof body.quoteKey !== "string" || !body.quoteKey) throw new PoolError("Review and confirm a shipping quote first.");
      destination = {address, quoteKey: body.quoteKey};
    }
    const { invoiceUrl, pickupOrder } = await requestShipment(db, admin, shop, viewer, { pickup: body.pickup === true, pullIds, destination });
    return json(pickupOrder ? { pickupOrder, pickupAddress: PICKUP_LOCATION.address, pickupHours: PICKUP_LOCATION.hours } : { invoiceUrl });
  } catch (error) {
    if (error instanceof PoolError) return json({ error: error.message }, 400);
    console.error("Ship request failed", error);
    return json({ error: "Couldn't start your shipment. Please try again." }, 500);
  }
};
