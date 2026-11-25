// POST /api/store/action {action, requestId, id, amount, openLater, copyIds} -> {...result, state}
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { storeAction, storeState } from "../site/store/store.server";
import { json, sameOriginJson, siteOn, storeErrorResponse } from "../site/store/http.server";

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
  try {
    const result = await storeAction(db, customer, input);
    const fresh = await db.siteCustomer.findUnique({ where: { id: customer.id } });
    return json({ ...result, state: await storeState(db, fresh) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
