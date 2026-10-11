import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { PoolError } from "../lib/pool.server";
import { json, proxyContext } from "../lib/proxy.server";
import { requestShipment } from "../lib/vault.server";

// "Ship my cards": starts a shipment for everything in the viewer's vault and returns the
// invoice link where they pay the shipping fee (or check out free on large shipments).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, viewer, admin } = await proxyContext(request);
  if (!viewer) return json({ error: "Log in to ship your cards." }, 401);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!admin) return json({ error: "Shipping isn't available right now. Please try again." }, 503);

  try {
    const { invoiceUrl } = await requestShipment(db, admin, shop, viewer);
    return json({ invoiceUrl });
  } catch (error) {
    if (error instanceof PoolError) return json({ error: error.message }, 400);
    console.error("Ship request failed", error);
    return json({ error: "Couldn't start your shipment. Please try again." }, 500);
  }
};
