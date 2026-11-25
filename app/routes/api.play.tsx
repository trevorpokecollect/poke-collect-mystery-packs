// GET /api/play -> {signedIn, paused: {kind, until} | null} for the site's paused banner and
// the floating rewards launcher. 404 unless CARDBIT_SITE=on.
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { json, siteOn } from "../site/store/http.server";
import { playStateFor } from "../site/play/limits.server";
import { gateApi } from "../site/waitlist/gate.server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (!siteOn()) return new Response("Not found", { status: 404 });
  { const gated = gateApi(request); if (gated) return gated; }
  const customer = await currentCustomer(db, request);
  if (!customer) return json({ signedIn: false, paused: null });
  return json({ signedIn: true, ...(await playStateFor(db, customer.id)) });
}
