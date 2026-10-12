import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";
import { packsPageUrl, storefrontBase } from "../lib/links.server";

// Called by the customer account Orders page block: does this customer have mystery packs,
// and where is their My Packs page?
//
//   GET /api/my-packs  ->  { packs: 0 } | { packs, unopened, url }

async function handle(request: Request) {
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);
  const shop = String(sessionToken.dest).replace(/^https:\/\//, "");
  const customerId = sessionToken.sub ?? null;
  const reply = (body: unknown) => cors(Response.json(body, { headers: { "Cache-Control": "no-store" } }));
  if (!customerId) return reply({ packs: 0 });

  // Count packs, not cards: a multi-card pack is several pulls on one card index each.
  const [packs, unopened] = await Promise.all([
    db.pull.count({ where: { shop, customerId, status: { not: "VOIDED" }, cardIndex: 0 } }),
    db.pull.count({ where: { shop, customerId, status: "UNOPENED", cardIndex: 0 } }),
  ]);
  if (packs === 0) return reply({ packs: 0 });

  const { admin } = await unauthenticated.admin(shop);
  return reply({ packs, unopened, url: packsPageUrl(await storefrontBase(admin, shop)) });
}

export const loader = ({ request }: LoaderFunctionArgs) => handle(request);
// Preflight (OPTIONS) requests arrive here; the authenticate helper answers them with CORS headers.
export const action = ({ request }: ActionFunctionArgs) => handle(request);
