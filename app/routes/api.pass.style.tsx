// GET /api/pass/style: the signed-in member's Pack Pass opening style (card sleeve + reveal effect) for the
// Signal Decode opening (public/site/js/cardbit-site-decode.js). Empty for guests and non-members, and the
// moment a plan's perks end. Looks only: nothing here touches what a pack pulls.
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { json, siteOn } from "../site/store/http.server";
import { activeTier } from "../site/play/subscriptions.server";
import { openingStyle } from "../site/play/pass-style";
import { SITE_SHOP } from "../site/rewards/rewards.server";
import { gateApi } from "../site/waitlist/gate.server";

const NONE = { sleeve: null, reveal: null };

export async function loader({ request }: LoaderFunctionArgs) {
  if (!siteOn()) return new Response("Not found", { status: 404 });
  { const gated = gateApi(request); if (gated) return gated; }
  const customer = await currentCustomer(db, request);
  if (!customer) return json(NONE);
  const [tier, saved] = await Promise.all([
    activeTier(db, customer.id),
    db.cardbitProfile.findUnique({
      where: { shop_customerId: { shop: SITE_SHOP, customerId: customer.id } },
      select: { sleeveId: true, revealFx: true, iconId: true },
    }),
  ]);
  return json(openingStyle(saved, tier?.id));
}
