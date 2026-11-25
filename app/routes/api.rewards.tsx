// GET/POST /api/rewards: Levels, daily check-in, Latch & Friends icons, Daily Spins and the Weekly
// Leaderboard for the signed-in site customer. Same engagement code and response shape as the
// Shopify proxy route (proxy.api.rewards.tsx), keyed by the site's own shop key.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { json, sameOriginJson, siteOn } from "../site/store/http.server";
import { LevelError, dailyCheckIn, rewardsView, setAvatar } from "../lib/cardbit-levels.server";
import { SpinError, dailySpin } from "../lib/cardbit-spinner.server";
import { AGE_REQUIRED, ageConfirmed, confirmAge } from "../lib/cardbit-age.server";
import { SITE_SHOP, siteLeaderboardOn, siteLevelsOn, siteWeeklyStandings } from "../site/rewards/rewards.server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (!siteOn()) return new Response("Not found", { status: 404 });
  if (!siteLevelsOn()) return json({ enabled: false });
  const customer = await currentCustomer(db, request);
  const leaderboard = siteLeaderboardOn() ? await siteWeeklyStandings(db, customer?.id) : null;
  if (!customer) return json({ enabled: true, signedIn: false, leaderboard });
  return json({ signedIn: true, ...(await rewardsView(db, SITE_SHOP, customer.id)), leaderboard });
}

export async function action({ request }: ActionFunctionArgs) {
  if (!siteOn()) return new Response("Not found", { status: 404 });
  if (!siteLevelsOn()) return json({ error: "Rewards are not open yet." }, 404);
  if (request.method !== "POST" || !sameOriginJson(request)) return json({ error: "Method not allowed." }, 405);
  const customer = await currentCustomer(db, request);
  if (!customer) return json({ error: "Sign In to Cardbit.", code: "sign_in" }, 401);
  if (customer.frozenAt) return json({ error: "This account is on hold. Contact Support@cardbit.com.", code: "account_frozen" }, 403);
  const input = (await request.json().catch(() => null)) as
    | { action?: unknown; iconId?: unknown; color?: unknown; tier?: unknown }
    | null;
  try {
    if (input?.action === "confirm-age") {
      await confirmAge(db, SITE_SHOP, customer.id, "prompt");
      return json({ ok: true });
    }
    if (input?.action === "checkin") {
      const result = await dailyCheckIn(db, SITE_SHOP, customer.id);
      return json({ checkIn: result, ...(await rewardsView(db, SITE_SHOP, customer.id)) });
    }
    if (input?.action === "spin") {
      if (!(await ageConfirmed(db, SITE_SHOP, customer.id))) return json(AGE_REQUIRED, 403);
      const spin = await dailySpin(db, SITE_SHOP, customer.id, input.tier);
      return json({
        result: { tier: spin.tier, prizeKind: spin.prizeKind, amount: spin.amount, card: spin.card, replay: spin.replay },
        ...(await rewardsView(db, SITE_SHOP, customer.id)),
      });
    }
    if (input?.action === "avatar") {
      await setAvatar(db, SITE_SHOP, customer.id, { iconId: input.iconId, color: input.color });
      return json(await rewardsView(db, SITE_SHOP, customer.id));
    }
    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    if (error instanceof LevelError || error instanceof SpinError) return json({ error: error.message }, 409);
    throw error;
  }
}
