import db from "../db.server";
import {enabled as cardbitEnabled} from "../../../../workspace/mode.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { parseEstimateLines } from "../lib/entries/estimate";
import {
  orderEntries,
  orderIdFromGid,
} from "../lib/entries/order-entries.server";

// Called by the giveaway-thank-you extension on the thank-you and order status pages.
//
//   POST /api/cardbit-campaign-order-entries  (Authorization: Bearer <extension session token>)
//   { surface: "checkout" | "account", orderId: <gid>, lines: [{ productId, variantId, price, quantity }] }
//
// The app proxy isn't reachable from checkout, so the extension calls the app directly.
// Responses only say how many entries the order earned in which giveaway, nothing personal.

async function authenticateSurface(request: Request, surface: string) {
  if (surface === "account") {
    const { sessionToken, cors } =
      await authenticate.public.customerAccount(request);
    return {
      shop: String(sessionToken.dest).replace(/^https:\/\//, ""),
      customerId: sessionToken.sub ?? null,
      cors,
    };
  }
  const { sessionToken, cors } = await authenticate.public.checkout(request);
  return {
    shop: String(sessionToken.dest).replace(/^https:\/\//, ""),
    customerId: null,
    cors,
  };
}

/** When the order was placed, or null if Shopify doesn't know it yet (or the lookup failed). */
async function placedAt(shop: string, orderGid: string) {
  const id = orderIdFromGid(orderGid);
  if (!id) return null;
  try {
    const { admin } = await unauthenticated.admin(shop);
    const res = await admin.graphql(
      `#graphql
      query OrderPlacedAt($id: ID!) { order(id: $id) { createdAt } }`,
      { variables: { id: `gid://shopify/Order/${id}` } },
    );
    const body = (await res.json()) as {
      data?: { order?: { createdAt?: string } | null };
    };
    const at = body.data?.order?.createdAt;
    return at ? new Date(at) : null;
  } catch (error) {
    console.error("order-entries: order lookup failed", error);
    return null;
  }
}

async function handle(request: Request) {
  const url = new URL(request.url);
  // Preflight requests carry no body; the surface for them comes from the query string.
  const body = (
    request.method === "POST"
      ? await request
          .clone()
          .json()
          .catch(() => ({}))
      : {}
  ) as Record<string, unknown>;
  const surface =
    (typeof body.surface === "string" && body.surface) ||
    url.searchParams.get("surface") ||
    "checkout";
  const { shop, customerId, cors } = await authenticateSurface(
    request,
    surface,
  );
  if(!cardbitEnabled(shop)) return cors(new Response(null,{status:404}));
  const orderGid =
    typeof body.orderId === "string"
      ? body.orderId
      : url.searchParams.get("orderId");
  const numeric=orderIdFromGid(orderGid);
  if(numeric && customerId){
    const event=await db.cardbitGiveawayEvent.findFirst({where:{shop,customerId,key:"fund:gid://shopify/Order/"+numeric,kind:"purchase",voided:false}});
    if(event) return cors(Response.json({status:"earned",giveaways:[{title:"Daily Cardbit giveaway",entries:event.entries}]},{headers:{"Cache-Control":"no-store"}}));
  }
  const result = await orderEntries({
    shop,
    orderGid,
    customerId,
    lines: parseEstimateLines(body.lines),
    placedAt: () =>
      orderGid ? placedAt(shop, orderGid) : Promise.resolve(null),
  });
  return cors(
    Response.json(result, { headers: { "Cache-Control": "no-store" } }),
  );
}

export const loader = ({ request }: LoaderFunctionArgs) => handle(request);
// Preflight (OPTIONS) requests arrive here; the authenticate helpers answer them with CORS headers.
export const action = ({ request }: ActionFunctionArgs) => handle(request);
