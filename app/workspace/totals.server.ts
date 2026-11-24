import { Prisma, type PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { gql } from "../lib/orders.server";
import { liveWorkspace } from "./mode.server";

export type Bucket = { cards: number; cents: number; unpriced: number };
export type Totals = {
  packs: Bucket & { pools: number };
  listed: Bucket & { listings: number; partial: boolean };
  vaults: Bucket & { unopened: number; owners: number };
  asOf: string;
};

const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);
// Live mode counts only real pools; the review workspace counts its staff test pools.
const testFilter = () =>
  liveWorkspace(shop) ? Prisma.sql`AND NOT s."staffTest"` : Prisma.empty;

/** Unclaimed copies still in LIVE pools, at the pool's stored retail value. */
async function inPacks(db: PrismaClient) {
  const [row] = await db.$queryRaw<
    { cards: bigint; value: Prisma.Decimal | null; pools: bigint }[]
  >`SELECT count(*) AS cards, sum(c."marketValue") AS value, count(DISTINCT s.id) AS pools
      FROM "Slot" sl JOIN "Series" s ON s.id=sl."seriesId" JOIN "Card" c ON c.id=sl."cardId"
     WHERE s.shop=${shop} AND s.status='LIVE' AND NOT sl.claimed AND NOT sl.voided ${testFilter()}`;
  return {
    cards: Number(row?.cards ?? 0),
    cents: cents(row?.value),
    unpriced: 0,
    pools: Number(row?.pools ?? 0),
  };
}

/** Copies customers own and Cardbit still holds: won or bought into a vault, not shipped or sold back. */
async function inVaults(db: PrismaClient) {
  const [row] = await db.$queryRaw<
    {
      cards: bigint;
      value: Prisma.Decimal | null;
      unopened: bigint;
      owners: bigint;
    }[]
  >`SELECT count(*) AS cards, sum(c."marketValue") AS value,
           count(*) FILTER (WHERE p.status='UNOPENED') AS unopened,
           count(DISTINCT p."customerId") AS owners
      FROM "Pull" p JOIN "Series" s ON s.id=p."seriesId" JOIN "Slot" sl ON sl.id=p."slotId"
      JOIN "Card" c ON c.id=sl."cardId" JOIN "PackOrder" o ON o."orderId"=p."orderId" AND o.shop=p.shop
      LEFT JOIN "CardbitBuyback" b ON b."copyId"=p.id AND b."acceptedAt" IS NOT NULL
     WHERE p.shop=${shop} AND o.vault AND p.status IN ('UNOPENED','REVEALED')
       AND p."shipRequestId" IS NULL AND b."copyId" IS NULL ${testFilter()}`;
  return {
    cards: Number(row?.cards ?? 0),
    cents: cents(row?.value),
    unpriced: 0,
    unopened: Number(row?.unopened ?? 0),
    owners: Number(row?.owners ?? 0),
  };
}

type VariantPage = {
  productVariants: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      price: string;
      product: { status: string; productType: string };
      inventoryItem: {
        tracked: boolean;
        inventoryLevels: {
          nodes: { quantities: { quantity: number }[] }[];
        };
      } | null;
    }[];
  };
};
const PAGE = 250,
  MAX_PAGES = 80;

/**
 * Singles for sale on the Cardbit storefront: active, tracked, available copies at their
 * Shopify price. Copies reserved for pools are not "available", so they are not counted twice.
 */
async function listed(admin: AdminApiContext) {
  let after: string | null = null,
    cards = 0,
    total = 0,
    listings = 0,
    partial = true;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: VariantPage = await gql<VariantPage>(
      admin,
      `#graphql
      query WorkspaceListedSingles($first:Int!, $after:String, $query:String!){
        productVariants(first:$first, after:$after, query:$query){
          pageInfo { hasNextPage endCursor }
          nodes {
            price
            product { status productType }
            inventoryItem { tracked inventoryLevels(first:10){ nodes { quantities(names:["available"]){ quantity } } } }
          }
        }
      }`,
      {
        first: PAGE,
        after,
        query: "product_status:active AND inventory_quantity:>0",
      },
    );
    for (const v of data.productVariants.nodes) {
      if (
        v.product.status !== "ACTIVE" ||
        !/single/i.test(v.product.productType) ||
        !v.inventoryItem?.tracked
      )
        continue;
      const qty = v.inventoryItem.inventoryLevels.nodes.reduce(
        (n, l) => n + Math.max(0, l.quantities[0]?.quantity ?? 0),
        0,
      );
      if (qty < 1) continue;
      listings++;
      cards += qty;
      total += qty * cents(v.price);
    }
    if (!data.productVariants.pageInfo.hasNextPage) {
      partial = false;
      break;
    }
    after = data.productVariants.pageInfo.endCursor;
  }
  return { cards, cents: total, unpriced: 0, listings, partial };
}

export async function inventoryTotals(
  db: PrismaClient,
  admin: AdminApiContext,
): Promise<Totals> {
  const [packs, vaults, site] = await Promise.all([
    inPacks(db),
    inVaults(db),
    listed(admin),
  ]);
  return { packs, listed: site, vaults, asOf: new Date().toISOString() };
}
