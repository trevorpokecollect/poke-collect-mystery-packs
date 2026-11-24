import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { json, proxyContext } from "../lib/proxy.server";
import { sparksEnabled, sparksView } from "../lib/cardbit-sparks.server";
import { SparkShopError, buySparkShopCard, sparkShopView } from "../lib/cardbit-spark-shop.server";
import { AGE_REQUIRED, ageConfirmed } from "../lib/cardbit-age.server";
import { guardRequest } from "../lib/cardbit-guard.server";

/** Spark Shop listing (prices in Sparks only) and purchases for the signed-in customer. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, viewer } = await proxyContext(request);
  if (!sparksEnabled(shop, viewer?.customerId)) return json({ enabled: false });
  const cards = await sparkShopView(db, shop);
  const wallet = viewer?.customerId ? await sparksView(db, shop, viewer.customerId) : null;
  return json({ enabled: true, signedIn: !!viewer?.customerId, balance: wallet?.balance ?? null, cards });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, viewer, admin } = await proxyContext(request);
  if (!sparksEnabled(shop, viewer?.customerId)) return json({ error: "The Spark Shop is not open yet." }, 404);
  if (!viewer?.customerId) return json({ error: "Sign In to Cardbit." }, 401);
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!(await ageConfirmed(db, shop, viewer.customerId))) return json(AGE_REQUIRED, 403);
  const refused = await guardRequest(request, { db, shop, customerId: viewer.customerId, action: "spark-shop", admin });
  if (refused) return refused;
  try {
    const input = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await buySparkShopCard(db, shop, viewer.customerId, {
      cardId: input.cardId,
      requestId: input.requestId,
      sparks: input.sparks,
    });
    return json({ ...result, balance: (await sparksView(db, shop, viewer.customerId)).balance });
  } catch (error) {
    if (error instanceof SparkShopError) return json({ error: error.message }, 409);
    throw error;
  }
};
