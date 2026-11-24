import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { json, proxyContext } from "../lib/proxy.server";
import {
  LevelError,
  dailyCheckIn,
  levelsEnabled,
  rewardsView,
  setAvatar,
} from "../lib/cardbit-levels.server";
import { SpinError, dailySpin } from "../lib/cardbit-spinner.server";
import { leaderboardEnabled, weeklyStandings } from "../lib/cardbit-leaderboard.server";
import { ageConfirmed, AGE_REQUIRED } from "../lib/cardbit-age.server";
import { guardRequest } from "../lib/cardbit-guard.server";

/** Levels, daily check-in and Latch & Friends icons for the signed-in Cardbit customer. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, viewer } = await proxyContext(request);
  if (!levelsEnabled(shop, viewer?.customerId)) return json({ enabled: false });
  const leaderboard = leaderboardEnabled(shop, viewer?.customerId) ? await weeklyStandings(db, shop, viewer?.customerId) : null;
  if (!viewer?.customerId) return json({ enabled: true, signedIn: false, leaderboard });
  return json({ signedIn: true, ...(await rewardsView(db, shop, viewer.customerId)), leaderboard });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, viewer, admin } = await proxyContext(request);
  if (!levelsEnabled(shop, viewer?.customerId)) return json({ error: "Rewards are not open yet." }, 404);
  if (!viewer?.customerId) return json({ error: "Sign In to Cardbit." }, 401);
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const input = (await request.json().catch(() => null)) as
    | { action?: unknown; iconId?: unknown; color?: unknown; tier?: unknown }
    | null;
  const guardAction = input?.action === "spin" ? "spin" : input?.action === "checkin" ? "checkin" : "avatar";
  const refused = await guardRequest(request, { db, shop, customerId: viewer.customerId, action: guardAction, admin });
  if (refused) return refused;
  try {
    if (input?.action === "checkin") {
      const result = await dailyCheckIn(db, shop, viewer.customerId);
      return json({ checkIn: result, ...(await rewardsView(db, shop, viewer.customerId)) });
    }
    if (input?.action === "spin") {
      if (!(await ageConfirmed(db, shop, viewer.customerId))) return json(AGE_REQUIRED, 403);
      const spin = await dailySpin(db, shop, viewer.customerId, input.tier);
      return json({
        result: { tier: spin.tier, prizeKind: spin.prizeKind, amount: spin.amount, card: spin.card, replay: spin.replay },
        ...(await rewardsView(db, shop, viewer.customerId)),
      });
    }
    if (input?.action === "avatar") {
      await setAvatar(db, shop, viewer.customerId, { iconId: input.iconId, color: input.color });
      return json(await rewardsView(db, shop, viewer.customerId));
    }
    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    if (error instanceof LevelError || error instanceof SpinError) return json({ error: error.message }, 409);
    throw error;
  }
};
