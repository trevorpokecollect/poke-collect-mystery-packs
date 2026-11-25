// GET /api/portfolio: Vault Portfolio for the signed-in site customer (same shape as the Shopify proxy).
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { json, siteOn } from "../site/store/http.server";
import { sitePortfolio } from "../site/store/portfolio.server";
import { gateApi } from "../site/waitlist/gate.server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (!siteOn()) return new Response("Not found", { status: 404 });
  { const gated = gateApi(request); if (gated) return gated; }
  const customer = await currentCustomer(db, request);
  if (!customer) return json({ error: "Sign in to view your vault portfolio." }, 401);
  try {
    return json(await sitePortfolio(db, customer.id));
  } catch (e) {
    console.warn("[site] portfolio failed", e instanceof Error ? e.message : e);
    return json({ error: "Your portfolio could not be loaded. Try again." }, 503);
  }
}
