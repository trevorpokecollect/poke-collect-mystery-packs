import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { isCardbit } from "../lib/cardbit.server";
import type { ShopperState } from "../lib/demo-shopper.server";
import { gql } from "../lib/orders.server";
import { proxyContext, json } from "../lib/proxy.server";
import { identityKey, type Identity } from "../workspace/book.server";
import { unpack, type Bundle } from "../workspace/demo-catalog.server";
import { marketApproved } from "../workspace/market.server";
import { vaultMarketHistory } from "../workspace/vault-market.server";

// The preview collection has different ownership records from a paid wallet.
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, viewer, session, admin } = await proxyContext(request);
  if (!isCardbit(shop) || session?.shop !== shop || !admin || !marketApproved())
    return json({ marketHistory: null }, 404);
  const id = viewer?.customerId;
  if (!id || !/^gid:\/\/shopify\/Customer\/\d+$/.test(id))
    return json({ marketHistory: null }, 401);
  const { customer } = await gql<{
    customer: null | {
      id: string;
      tags: string[];
      seed: { jsonValue: ShopperState } | null;
      catalog: { jsonValue: Bundle } | null;
    };
  }>(
    admin,
    `#graphql
      query VaultShopperHistoryOwner($id: ID!) {
        customer(id:$id) { id tags
          seed:metafield(namespace:"cardbit_preview",key:"seed_v1"){jsonValue}
          catalog:metafield(namespace:"cardbit_preview",key:"catalog_v1"){jsonValue}
        }
      }`,
    { id },
  );
  const seed = customer?.seed?.jsonValue,
    archive = customer?.catalog?.jsonValue;
  if (
    customer?.id !== id ||
    !customer.tags.includes("cardbit-demo-shopper") ||
    !archive ||
    seed?.v !== 1 ||
    seed.version !== archive.version
  )
    return json({ marketHistory: null }, 404);
  const saved = await db.cardbitDemoAccount.findUnique({
    where: { shop_customerId: { shop, customerId: id } },
    select: { state: true },
  });
  const current = (saved?.state as unknown as ShopperState | undefined) ?? seed;
  if (current.version !== archive.version)
    return json({ marketHistory: null }, 409);
  const catalog = unpack(archive);
  const held = new Set(
    current.copies
      .filter((copy) => copy.status === "held")
      .map((copy) => copy.cardId),
  );
  const cards = [...catalog.cards, ...(catalog.archivedCards ?? [])];
  const keys = cards.flatMap((card) => {
    const key = held.has(card.id) && identityKey(card as Identity);
    return key ? [key] : [];
  });
  return json({ marketHistory: await vaultMarketHistory(keys) });
}
