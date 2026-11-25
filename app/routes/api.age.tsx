// GET/POST /api/age: the signed-in site customer's own 18+ confirmation.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { confirmSiteAge, siteAgeConfirmed } from "../site/core/age.server";
import { AGE_SOURCES, type AgeSource } from "../lib/cardbit-age.server";
import { json, sameOriginJson, siteOn } from "../site/store/http.server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (!siteOn()) return new Response("Not found", { status: 404 });
  const customer = await currentCustomer(db, request);
  if (!customer) return json({ error: "Sign In to Continue.", code: "sign_in" }, 401);
  const at = await siteAgeConfirmed(db, customer.id);
  return json({ confirmed: Boolean(at), confirmedAt: at });
}

export async function action({ request }: ActionFunctionArgs) {
  if (!siteOn()) return new Response("Not found", { status: 404 });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!sameOriginJson(request)) return json({ error: "Bad request." }, 400);
  const customer = await currentCustomer(db, request);
  if (!customer) return json({ error: "Sign In to Continue.", code: "sign_in" }, 401);
  const input = (await request.json().catch(() => null)) as { confirm?: unknown; source?: unknown } | null;
  if (!input || input.confirm !== true || !AGE_SOURCES.includes(input.source as AgeSource))
    return json({ error: "Confirm You're 18 or Older to Continue." }, 400);
  const at = await confirmSiteAge(db, customer.id, input.source as AgeSource);
  return json({ confirmed: true, confirmedAt: at });
}
