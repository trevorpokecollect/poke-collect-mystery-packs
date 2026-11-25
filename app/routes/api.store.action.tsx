// POST /api/store/action {action, requestId, id, amount, openLater, copyIds} -> {...result, state}
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { storeAction, storeState } from "../site/store/store.server";
import { json, sameOriginJson, siteOn, storeErrorResponse } from "../site/store/http.server";
import { clientIp } from "../site/core/auth.server";
import { RegionBlocked } from "../site/region.server";
import { CopyLockError, FeePaymentError, ShippingError, createShipment, parseAddress } from "../site/shipping/service.server";
import { siteShippingDeps } from "../site/shipping/wire.server";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/** ship / ship-group with a delivery address → real vault shipment (fee in Cardbits, free over 30 cards). */
async function ship(request: Request, customer: { id: string; email: string; frozenAt: Date | null; closedAt: Date | null }, input: Record<string, unknown>) {
  if (customer.frozenAt || customer.closedAt) return json({ error: "This account is on hold. Contact Support@cardbit.com.", code: "account_frozen" }, 403);
  const requestId = String(input.requestId || "");
  const ids = input.action === "ship" ? [input.id] : input.copyIds;
  if (!UUID.test(requestId) || !Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some((x) => typeof x !== "string" || x.length > 60) || new Set(ids).size !== ids.length)
    return json({ error: "Choose each held card once.", code: "invalid" }, 400);
  if (input.method !== undefined && input.method !== "CARDBITS") return json({ error: "Shipping is paid with Cardbits.", code: "invalid" }, 400);
  try {
    const r = await createShipment(siteShippingDeps(), {
      customerId: customer.id,
      customerEmail: customer.email,
      copyIds: ids as string[],
      address: parseAddress(input.address),
      billing: null,
      ip: clientIp(request),
      method: "CARDBITS",
      idempotencyKey: requestId,
    });
    return { shipmentId: r.shipment.id, replay: r.replay };
  } catch (e) {
    if (e instanceof ShippingError && e.code === "ADDRESS_INVALID") return json({ error: e.message, code: "address_invalid", fields: e.details }, 400);
    if (e instanceof ShippingError) return json({ error: e.message, code: e.code.toLowerCase() }, 409);
    if (e instanceof RegionBlocked) return json({ error: e.message, code: "region_blocked" }, 403);
    if (e instanceof CopyLockError) return json({ error: "Some cards are no longer in your vault.", code: "unavailable", unavailable: e.unavailable }, 409);
    if (e instanceof FeePaymentError) return json({ error: e.code === "INSUFFICIENT_BITS" ? "Add Cardbits to pay for shipping." : e.message, code: e.code.toLowerCase() }, 409);
    throw e;
  }
}

export const loader = () => new Response("Not found", { status: 404 });

export async function action({ request }: ActionFunctionArgs) {
  if (!siteOn()) return new Response("Not found", { status: 404 });
  if (request.method !== "POST" || !sameOriginJson(request)) return json({ error: "Invalid request.", code: "invalid" }, 400);
  const customer = await currentCustomer(db, request);
  if (!customer) return json({ error: "Sign In to Continue.", code: "sign_in" }, 401);
  const raw = await request.text();
  if (raw.length > 28_000) return json({ error: "Select fewer cards.", code: "invalid" }, 413);
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid request.", code: "invalid" }, 400);
  }
  if ((input?.action === "ship" || input?.action === "ship-group") && input?.address) {
    const shipped = await ship(request, customer, input);
    if (shipped instanceof Response) return shipped;
    const fresh = await db.siteCustomer.findUnique({ where: { id: customer.id } });
    return json({ ...shipped, state: await storeState(db, fresh) });
  }
  try {
    const result = await storeAction(db, customer, input);
    const fresh = await db.siteCustomer.findUnique({ where: { id: customer.id } });
    return json({ ...result, state: await storeState(db, fresh) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
