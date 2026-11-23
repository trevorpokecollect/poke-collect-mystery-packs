import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { parseEstimateLines } from "../lib/entries/estimate";
import { estimateForShop } from "../lib/entries/estimate.server";

// "Earn X entries" estimates for the product and cart badges, at /apps/packs/campaigns/estimate.
//
//   GET  ?product=<id>&variant=<id>&price=<cents>&quantity=<n>[&giveaway=<link name>]
//   POST { giveaway?, lines: [{ productId, variantId, price, quantity }] }
//   POST { giveaway?, items: <the items array from /cart.js> }
//
// Prices are in cents, as Liquid and /cart.js report them.

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const shopFrom = (request: Request) =>
  new URL(request.url).searchParams.get("shop") ?? "";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const q = new URL(request.url).searchParams;
  const lines = parseEstimateLines([
    {
      productId: q.get("product"),
      variantId: q.get("variant"),
      price: q.get("price"),
      quantity: q.get("quantity") ?? 1,
    },
  ]);
  return json(
    await estimateForShop(shopFrom(request), q.get("giveaway"), lines),
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  // /cart.js items: final_price is the unit price after line-level discounts.
  const items = Array.isArray(body.items)
    ? body.items.map((i: Record<string, unknown>) => ({
        ...i,
        price: i.final_price ?? i.price,
      }))
    : body.lines;
  return json(
    await estimateForShop(
      shopFrom(request),
      typeof body.giveaway === "string" ? body.giveaway : null,
      parseEstimateLines(items),
    ),
  );
};
