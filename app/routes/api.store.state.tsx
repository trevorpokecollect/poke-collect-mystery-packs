// GET /api/store/state: catalog + the signed-in customer's wallet, vault, openings and history.
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { storeState } from "../site/store/store.server";
import { json, siteOn } from "../site/store/http.server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (!siteOn()) return new Response("Not found", { status: 404 });
  // Read-only catalog: open in coming-soon mode so the browse pages work; purchases stay gated in /api/store/action.
  const customer = await currentCustomer(db, request);
  return json(await storeState(db, customer));
}
