import type { ActionFunctionArgs } from "react-router";
import { randomBytes } from "node:crypto";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { gql } from "../lib/orders.server";
import { resolveCustomer } from "../lib/vault.server";

// Staff test cards for trying Vault Market (Trevor asked, 2026-10-20):
// POST /jobs/staff-test-cards?shop=<shop> with the cron secret and { email, count?, minPrice? }.
// Puts `count` real in-stock singles (Near Mint, at least minPrice) into that customer's vault as a
// "Staff Test Cards" series. Nothing is reserved or charged. These cards are hidden on Vault Market
// from everyone except their owner and customers tagged "vault-tester" (see market.server NOT_TEST).
export const action = async ({ request }: ActionFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const shop = new URL(request.url).searchParams.get("shop");
  if (!shop) return Response.json({ error: "shop is required" }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as { email?: string; count?: number; minPrice?: number };
  if (!body.email) return Response.json({ error: "email is required" }, { status: 400 });
  const count = Math.min(Math.max(Number(body.count) || 8, 1), 24);
  const minPrice = Number(body.minPrice) || 5;

  const { admin } = await unauthenticated.admin(shop);
  const who = await resolveCustomer(db, admin, body.email);

  const data = await gql(admin, `#graphql
    query StaffTestSingles($q: String!) {
      productVariants(first: 100, query: $q, sortKey: ID, reverse: true) {
        nodes { id title price inventoryQuantity displayName product { id title productType featuredMedia { preview { image { url } } } } media(first: 1) { nodes { preview { image { url } } } } }
      }
    }`, { q: `product_type:'Pokemon Single' AND title:'Near Mint' AND inventory_quantity:>0 AND price:>=${minPrice}` });
  type V = { id: string; title: string; price: string; displayName: string; product: { id: string; title: string; featuredMedia: { preview: { image: { url: string } | null } | null } | null }; media: { nodes: { preview: { image: { url: string } | null } | null }[] } };
  const picked = ((data.productVariants?.nodes ?? []) as V[])
    .filter((v) => v.product.featuredMedia?.preview?.image?.url)
    .sort(() => Math.random() - 0.5)
    .slice(0, count);
  if (!picked.length) return Response.json({ error: "No in-stock singles matched." }, { status: 404 });

  const stamp = Date.now().toString(36);
  const orderId = `staff-test-${stamp}`;
  const result = await db.$transaction(async (tx) => {
    const series = await tx.series.create({
      data: {
        shop,
        title: "Staff Test Cards",
        handle: `staff-test-cards-${stamp}`,
        status: "CLOSED",
        staffTest: true,
        packProductId: "staff-test",
        packVariantId: `staff-test-${stamp}`,
        packPrice: 0,
      },
    });
    await tx.packOrder.create({
      data: { orderId, shop, orderName: "Staff Test", customerId: who.customerId, openToken: randomBytes(16).toString("hex"), vault: true, finalized: true },
    });
    const pulls = [];
    for (const [i, v] of picked.entries()) {
      const card = await tx.card.create({
        data: {
          seriesId: series.id,
          variantId: v.id,
          productId: v.product.id,
          title: v.title === "Default Title" ? v.product.title : v.displayName,
          imageUrl: v.media.nodes[0]?.preview?.image?.url ?? v.product.featuredMedia?.preview?.image?.url ?? null,
          tier: "Base",
          marketValue: v.price,
          quantity: 1,
          sortOrder: i,
        },
      });
      const slot = await tx.slot.create({ data: { seriesId: series.id, cardId: card.id, position: i, claimed: true } });
      pulls.push(
        await tx.pull.create({
          data: {
            shop,
            seriesId: series.id,
            slotId: slot.id,
            orderId,
            orderName: "Staff Test",
            lineItemId: `staff-test-${stamp}-${i}`,
            packIndex: i,
            customerId: who.customerId,
            status: "REVEALED",
            revealedAt: new Date(),
          },
        }),
      );
    }
    return { seriesId: series.id, cards: pulls.length };
  });
  return Response.json({ customer: who.label, ...result, titles: picked.map((v) => v.displayName) });
};
