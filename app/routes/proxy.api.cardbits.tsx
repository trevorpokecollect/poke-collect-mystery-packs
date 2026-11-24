import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { walletAction, walletAccess, walletView } from "../lib/cardbits.server";
import { PoolError } from "../lib/pool.server";
import { AGE_REQUIRED, ageConfirmed } from "../lib/cardbit-age.server";
import { json, proxyContext } from "../lib/proxy.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, viewer } = await proxyContext(request);
  if (!viewer?.customerId || !walletAccess(shop, viewer.customerId))
    return json({ error: "Sign in to Cardbit." }, 401);
  return json(await walletView(db, shop, viewer.customerId));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, viewer } = await proxyContext(request);
  if (!viewer?.customerId) return json({ error: "Sign in to Cardbit." }, 401);
  if (!walletAccess(shop, viewer.customerId))
    return json({ error: "Cardbits are unavailable." }, 404);
  if (request.method !== "POST")
    return json({ error: "Method not allowed." }, 405);
  try {
    const input = await request.json().catch(() => null);
    if (!input || typeof input !== "object")
      throw new PoolError("Review the offer again.");
    // Buying a pack with Cardbits requires the customer's 18+ confirmation.
    if ((input as { action?: unknown }).action === "pack" &&
        !(await ageConfirmed(db, shop, viewer.customerId)))
      return json(AGE_REQUIRED, 403);
    const receipt = await walletAction(db, shop, viewer.customerId, input);
    return json({
      receipt: receipt.id,
      openingId: receipt.openingId,
      copyId: receipt.copyId,
      delta: receipt.delta,
    });
  } catch (error) {
    if (error instanceof PoolError) return json({ error: error.message }, 409);
    throw error;
  }
};
