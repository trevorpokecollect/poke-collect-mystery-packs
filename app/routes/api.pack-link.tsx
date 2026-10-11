import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";
import { packsPageUrl, storefrontBase } from "../lib/links.server";
import { packImages } from "../lib/pack-art.server";

// Called by the thank-you and order status page extensions to get the "open your pack" link.
//
//   GET /api/pack-link?surface=checkout|account&checkoutToken=...&variants=gid1,gid2
//
// The checkout token (order.checkout_token) is only known to the buyer, so it identifies the order.
// On the customer account order status page, the logged-in customer must also own the order.
// Responses: none (no packs on this order), pending (paid, card not drawn yet), ready.

type LinkResponse =
  | { status: "none" }
  | { status: "pending"; packImageUrl: string | null }
  | { status: "ready"; url: string; packs: number; unopened: number; series: string; packImageUrl: string | null };

async function authenticateSurface(request: Request, surface: string) {
  if (surface === "account") {
    const { sessionToken, cors } = await authenticate.public.customerAccount(request);
    return { shop: String(sessionToken.dest).replace(/^https:\/\//, ""), customerId: sessionToken.sub ?? null, cors };
  }
  const { sessionToken, cors } = await authenticate.public.checkout(request);
  return { shop: String(sessionToken.dest).replace(/^https:\/\//, ""), customerId: null, cors };
}

async function handle(request: Request) {
  const url = new URL(request.url);
  const surface = url.searchParams.get("surface") ?? "checkout";
  const { shop, customerId, cors } = await authenticateSurface(request, surface);
  const reply = (body: LinkResponse) => cors(Response.json(body, { headers: { "Cache-Control": "no-store" } }));

  const found = await db.packOrder.findFirst({
    where: { shop, checkoutToken: url.searchParams.get("checkoutToken") || "__none__" },
  });
  const packOrder =
    found && surface === "account" && found.customerId && found.customerId !== customerId ? null : found;

  const { admin } = await unauthenticated.admin(shop);

  if (!packOrder) {
    // The orders/paid webhook can land a few seconds after the thank-you page renders.
    // Say "pending" only if this checkout actually bought a pack, so other orders show nothing.
    const variants = (url.searchParams.get("variants") ?? "").split(",").filter(Boolean);
    const series = variants.length
      ? await db.series.findFirst({ where: { shop, packVariantId: { in: variants } } })
      : null;
    if (!series) return reply({ status: "none" });
    const art = await packImages(admin, [series.packProductId]);
    return reply({ status: "pending", packImageUrl: art.get(series.packProductId) ?? null });
  }

  const pulls = await db.pull.findMany({
    where: { orderId: packOrder.orderId, status: { not: "VOIDED" } },
    include: { series: { select: { title: true, packProductId: true } } },
  });
  if (pulls.length === 0) return reply({ status: "none" });

  const art = await packImages(admin, [...new Set(pulls.map((p) => p.series.packProductId))]);
  const link = new URL(packsPageUrl(await storefrontBase(admin, shop), packOrder.openToken));
  link.searchParams.set("open", "1");

  return reply({
    status: "ready",
    url: link.toString(),
    packs: pulls.length,
    unopened: pulls.filter((p) => p.status === "UNOPENED").length,
    series: pulls[0].series.title,
    packImageUrl: art.get(pulls[0].series.packProductId) ?? null,
  });
}

export const loader = ({ request }: LoaderFunctionArgs) => handle(request);
// Preflight (OPTIONS) requests arrive here; the authenticate helpers answer them with CORS headers.
export const action = ({ request }: ActionFunctionArgs) => handle(request);
