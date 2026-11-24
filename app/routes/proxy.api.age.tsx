import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { isCardbit } from "../lib/cardbit.server";
import { AGE_SOURCES, ageConfirmed, confirmAge, type AgeSource } from "../lib/cardbit-age.server";
import { json, proxyContext } from "../lib/proxy.server";

// The signed-in customer's own 18+ confirmation. Shopify signs the proxy request,
// so the customer id comes from logged_in_customer_id, never from the body.
async function signedIn(request: Request) {
  const { shop, viewer } = await proxyContext(request);
  if (!isCardbit(shop)) return { response: json({ error: "Not found." }, 404) };
  if (!viewer?.customerId) return { response: json({ error: "Sign in to Cardbit." }, 401) };
  return { shop, customerId: viewer.customerId };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const who = await signedIn(request);
  if ("response" in who) return who.response;
  const at = await ageConfirmed(db, who.shop, who.customerId);
  return json({ confirmed: Boolean(at), confirmedAt: at });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const who = await signedIn(request);
  if ("response" in who) return who.response;
  const input = (await request.json().catch(() => null)) as { confirm?: unknown; source?: unknown } | null;
  if (!input || input.confirm !== true || !AGE_SOURCES.includes(input.source as AgeSource))
    return json({ error: "Confirm You're 18 or Older to Continue." }, 400);
  const at = await confirmAge(db, who.shop, who.customerId, input.source as AgeSource);
  return json({ confirmed: true, confirmedAt: at });
};
