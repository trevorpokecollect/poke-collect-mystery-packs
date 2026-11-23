import type { ActionFunctionArgs } from "react-router";
import { timingSafeEqual, createHash } from "node:crypto";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { enabled } from "../workspace/mode.server";
import { runGiveawayClock } from "../giveaway/clock.server";
export async function action({ request }: ActionFunctionArgs) {
  const key = process.env.CRON_SECRET,
    hash = (v: string) => createHash("sha256").update(v).digest();
  if (
    request.method !== "POST" ||
    !key ||
    !enabled(shop) ||
    !timingSafeEqual(
      hash(request.headers.get("authorization") ?? ""),
      hash("Bearer " + key),
    )
  )
    return new Response(null, { status: 403 });
  const result = await runGiveawayClock();
  return Response.json(result, { status: result.campaignErrors ? 503 : 200 });
}
