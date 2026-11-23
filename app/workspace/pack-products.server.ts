import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { CARDBIT_SHOP } from "../lib/cardbit.server";
import { gql } from "../lib/orders.server";
import { editions, type Edition } from "./model";

type Product = {
  id: string;
  handle: string;
  title: string;
  productType: string;
  status: string;
  variants: { nodes: { id: string; price: string }[] };
};
type Pack = {
  edition: Edition;
  productId: string;
  variantId: string;
  title: string;
  price: number;
  series: { id: string; title: string; status: string }[];
};
export async function workspacePackProducts(
  admin: AdminApiContext,
  db?: PrismaClient,
) {
  const handles = editions.map((e) => "cardbit-" + e + "-edition");
  const result = await gql<{
    shop: { myshopifyDomain: string };
    products: { nodes: Product[]; pageInfo: { hasNextPage: boolean } };
  }>(
    admin,
    `#graphql
    query WorkspacePackProducts($first:Int!, $after:String, $query:String!){
      shop { myshopifyDomain }
      products(first:$first, after:$after, query:$query) {
        nodes { id handle title productType status variants(first:2){nodes{id price}} }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    { first: 10, query: handles.map((h) => "handle:" + h).join(" OR ") },
  );
  if (
    result.shop.myshopifyDomain !== CARDBIT_SHOP ||
    result.products.pageInfo.hasNextPage
  )
    throw Error("The selected pack products could not be verified on Cardbit.");
  const packs: Partial<Record<Edition, Pack>> = {};
  for (const p of result.products.nodes) {
    const edition = editions.find(
      (e) => p.handle === "cardbit-" + e + "-edition",
    );
    const v = p.variants.nodes[0];
    if (
      !edition ||
      p.productType !== "Mystery Pack" ||
      p.status === "ARCHIVED" ||
      p.variants.nodes.length !== 1 ||
      !v ||
      !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(v.id) ||
      !/^gid:\/\/shopify\/Product\/\d+$/.test(p.id) ||
      !/^\d+(?:\.\d{1,2})?$/.test(v.price)
    )
      continue;
    const price = Math.round(Number(v.price) * 100);
    if (!Number.isSafeInteger(price) || price < 1) continue;
    packs[edition] = {
      edition,
      productId: p.id,
      variantId: v.id,
      title: p.title,
      price,
      series: [],
    };
  }
  if (db) {
    const byVariant = new Map(
      Object.values(packs).map((p) => [p.variantId, p]),
    );
    const rows = await db.series.findMany({
      where: {
        shop: CARDBIT_SHOP,
        staffTest: false,
        packVariantId: { in: [...byVariant.keys()] },
        status: { in: ["DRAFT", "LIVE"] },
      },
      select: { id: true, title: true, status: true, packVariantId: true },
      orderBy: { createdAt: "desc" },
    });
    for (const { id, title, status, packVariantId } of rows)
      byVariant.get(packVariantId)?.series.push({ id, title, status });
  }
  return packs;
}
