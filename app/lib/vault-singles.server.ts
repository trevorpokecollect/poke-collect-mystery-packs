// "Keep In My Vault (Ships Later)": singles bought on the website can go straight to the buyer's
// vault instead of shipping. Checkout only offers the $0 rate on singles-only carts for logged-in
// customers (extensions/vault-singles-delivery). Once paid, each single becomes a vault card like a
// pull (one "Bought From Poke-Collect" series per shop), and the order is marked fulfilled: staff
// set the cards aside in the vault bins. Shipping them later adds $0 custom lines (vault.server).
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { fulfillWholeOrder, gql, tagOrder } from "./orders.server";

export const VAULT_RATE_TITLE = "Keep In My Vault (Ships Later)";
export const SINGLE_PRODUCT_TYPE = "Pokemon Single";
export const VAULT_SINGLES_TAG = "vault-singles";

export function choseVaultRate(order: { shipping_lines?: { title?: string | null }[] | null }) {
  return (order.shipping_lines ?? []).some((l) => (l.title ?? "").trim().toLowerCase() === VAULT_RATE_TITLE.toLowerCase());
}

async function storeSeries(db: PrismaClient, shop: string) {
  const found = await db.series.findFirst({ where: { shop, storePurchase: true } });
  if (found) return found;
  return db.series.create({
    data: {
      shop,
      title: "Bought From Poke-Collect",
      handle: "bought-from-poke-collect",
      status: "CLOSED",
      storePurchase: true,
      packProductId: "store-purchase",
      packVariantId: "store-purchase",
      packPrice: 0,
    },
  });
}

type OrderLine = {
  id: string;
  quantity: number;
  title: string;
  variantTitle: string | null;
  image: { url: string } | null;
  variant: { id: string; displayName: string; product: { id: string; productType: string; featuredMedia: { preview: { image: { url: string } | null } | null } | null } } | null;
};

/** Puts the singles from a paid "Keep In My Vault" order into the buyer's vault. Safe to repeat. */
export async function vaultSinglesFromOrder(
  db: PrismaClient,
  admin: AdminApiContext,
  shop: string,
  order: { admin_graphql_api_id: string; name: string; customer?: { admin_graphql_api_id?: string } | null },
) {
  const orderId = order.admin_graphql_api_id;
  if (await db.packOrder.findUnique({ where: { orderId } })) return 0;
  const data = await gql(admin, `#graphql
    query VaultSinglesOrder($id: ID!) {
      order(id: $id) {
        customer { id }
        lineItems(first: 100) {
          nodes {
            id quantity title variantTitle image { url }
            variant { id displayName product { id productType featuredMedia { preview { image { url } } } } }
          }
        }
      }
    }`, { id: orderId });
  const customerId = (data.order?.customer?.id as string | undefined) ?? order.customer?.admin_graphql_api_id ?? null;
  const singles = ((data.order?.lineItems?.nodes ?? []) as OrderLine[]).filter(
    (l) => l.variant && l.variant.product.productType.trim().toLowerCase() === SINGLE_PRODUCT_TYPE.toLowerCase(),
  );
  if (!singles.length) return 0;
  const series = await storeSeries(db, shop);

  const count = await db.$transaction(async (tx) => {
    await tx.packOrder.create({
      data: { orderId, shop, orderName: order.name, customerId, openToken: randomBytes(16).toString("hex"), vault: true, finalized: true },
    });
    let n = 0;
    for (const line of singles) {
      const v = line.variant!;
      const card = await tx.card.upsert({
        where: { seriesId_variantId: { seriesId: series.id, variantId: v.id } },
        create: {
          seriesId: series.id,
          variantId: v.id,
          productId: v.product.id,
          title: v.displayName.replace(/ - Default Title$/, ""),
          imageUrl: line.image?.url ?? v.product.featuredMedia?.preview?.image?.url ?? null,
          tier: "Base",
          marketValue: 0,
          quantity: line.quantity,
        },
        update: { quantity: { increment: line.quantity } },
      });
      for (let i = 0; i < line.quantity; i++) {
        const slot = await tx.slot.create({ data: { seriesId: series.id, cardId: card.id, claimed: true } });
        await tx.pull.create({
          data: {
            shop,
            seriesId: series.id,
            slotId: slot.id,
            orderId,
            orderName: order.name,
            lineItemId: line.id,
            packIndex: i,
            customerId,
            status: "REVEALED",
            revealedAt: new Date(),
          },
        });
        n++;
      }
    }
    return n;
  });

  // Nothing ships now: the order is fulfilled and tagged so staff move the cards to the vault bins.
  await fulfillWholeOrder(admin, orderId).catch((e) => console.error(`Fulfilling vault singles order ${order.name} failed`, e));
  await tagOrder(admin, orderId, [VAULT_SINGLES_TAG]).catch((e) => console.error("Tag failed", e));
  return count;
}
