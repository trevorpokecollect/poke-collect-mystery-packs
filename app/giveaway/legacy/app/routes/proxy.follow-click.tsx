import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { clientIp } from "../lib/bot/fingerprint.server";
import { recordFollowClick } from "../lib/follow-clicks.server";

// Follow-button click beacon from the widget, at /apps/packs/campaigns/follow-click.
//
//   POST { giveaway: <link name or "latest">, action: <EntryAction id> }
//
// Sent with navigator.sendBeacon (text/plain body), so the reply is never read: always 204.

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const body = (await request
    .text()
    .then((t) => JSON.parse(t))
    .catch(() => ({}))) as Record<string, unknown>;
  const shop = new URL(request.url).searchParams.get("shop") ?? "";
  if (
    shop &&
    typeof body.giveaway === "string" &&
    typeof body.action === "string"
  ) {
    try {
      await recordFollowClick({
        shop,
        slug: body.giveaway.slice(0, 100),
        actionId: body.action.slice(0, 50),
        ip: clientIp(request),
      });
    } catch (e) {
      console.error("follow-click failed", e);
    }
  }
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
};

export const loader = () => new Response(null, { status: 405 });
