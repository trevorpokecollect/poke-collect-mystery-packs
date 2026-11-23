import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { burstCache } from "../lib/storefront/burst-cache";
import { winnersFeed } from "../lib/winners.server";

// Every Daily and Monthly winner, for the storefront "Giveaway Winners" page, at
// /apps/packs/campaigns/winners. Names are first name + last initial only ("Steven I.").
//
//   { daily: [{ date, giveaway, prize, imageUrl, productHandle, winners: ["Steven I."] }],
//     monthly: [{ drawnAt, giveaway, title, prize, imageUrl, winners: [...] }] }

const shared = burstCache(60_000);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const shop = new URL(request.url).searchParams.get("shop") ?? "";
  const feed = await shared.get(shop, () => winnersFeed(shop));
  return new Response(JSON.stringify(feed), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
    },
  });
};
