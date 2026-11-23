import { liveWorkspace } from "./mode.server";
import { marketApproved } from "./market.server";
import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { gql } from "../lib/orders.server";
import type { ShopperState } from "../lib/demo-shopper.server";
import { identityKey, readBook, lockBook, type DeskDb } from "./book.server";
import { unpack, type Bundle } from "./demo-catalog.server";
import { offer, portfolio, type Holding } from "./model";

type Position = { key: string; name: string };
async function nativePositions(
  tx: DeskDb,
  customerId: string,
  variants: Record<string, string>,
): Promise<Position[]> {
  const owned = await tx.pull.findMany({
    where: {
      shop,
      customerId,
      status: "REVEALED",
      shipRequestId: null,
      ...(liveWorkspace(shop) ? { series: { staffTest: false } } : {}),
    },
    select: { orderId: true },
    distinct: ["orderId"],
  });
  const vaultOrders = await tx.packOrder.findMany({
    where: { shop, orderId: { in: owned.map((c) => c.orderId) }, vault: true },
    select: { orderId: true },
  });
  const copies = await tx.pull.findMany({
    where: {
      shop,
      customerId,
      status: "REVEALED",
      shipRequestId: null,
      orderId: { in: vaultOrders.map((o) => o.orderId) },
      ...(liveWorkspace(shop) ? { series: { staffTest: false } } : {}),
    },
    select: {
      slot: { select: { card: { select: { variantId: true, title: true } } } },
    },
  });
  return copies.map(({ slot: { card } }) => ({
    key: variants[card.variantId] ?? card.variantId,
    name: card.title,
  }));
}
export async function vault(
  db: PrismaClient,
  admin: AdminApiContext,
  customerId: string,
  source: "shopper" | "wallet",
) {
  const allowMarket = marketApproved();
  let identities: Map<string, Position> | undefined;
  if (source === "shopper") {
    const result = await gql<{
      customer: { id: string; metafield: { jsonValue: Bundle } | null } | null;
    }>(
      admin,
      `#graphql
      query PortfolioPrintings($id:ID!){customer(id:$id){id metafield(namespace:"cardbit_preview",key:"catalog_v1"){jsonValue}}}`,
      { id: customerId },
    );
    if (result.customer?.id !== customerId || !result.customer.metafield)
      throw Error("This test account has no Cardbit catalog.");
    const catalog = unpack(result.customer.metafield.jsonValue);
    identities = new Map(
      catalog.cards.map((c) => [
        c.id,
        { key: identityKey(c) || c.id, name: c.name },
      ]),
    );
    for (const c of catalog.archivedCards ?? [])
      if (!identities.has(c.id))
        identities.set(c.id, { key: c.id, name: c.name });
  }
  return db.$transaction(async (tx) => {
    await lockBook(tx);
    const book = await readBook(tx);
    let copies: Position[];
    if (identities) {
      const row = await tx.cardbitDemoAccount.findUnique({
        where: { shop_customerId: { shop, customerId } },
      });
      const state = row?.state as unknown as ShopperState | undefined;
      copies = (state?.copies ?? [])
        .filter((c) => c.status === "held")
        .map(
          (c) =>
            identities!.get(c.cardId) ?? {
              key: c.cardId,
              name: "Unmatched printing",
            },
        );
    } else copies = await nativePositions(tx, customerId, book.variants);
    const counts = new Map<string, { qty: number; name: string }>();
    for (const c of copies)
      counts.set(c.key, {
        qty: (counts.get(c.key)?.qty ?? 0) + 1,
        name: c.name,
      });
    const ticks = await tx.cardbitDeskTick.findMany({
      where: { shop, key: { in: [...counts.keys()] } },
      orderBy: { at: "asc" },
    });
    const series = new Map<string, Holding["history"]>();
    for (const t of ticks) {
      const list = series.get(t.key) ?? [];
      list.push({
        at: t.at.toISOString(),
        bits: t.bits,
        market: allowMarket ? t.market : null,
      });
      series.set(t.key, list);
    }
    const holdings: Holding[] = [...counts].map(([key, c]) => {
      const ref = book.refs[key] ?? {
        key,
        name: c.name,
        set: "",
        number: "",
        finish: "",
        condition: "",
        language: "",
        retail: null,
        cash: null,
        market: null,
        marketDate: null,
        retailDate: "",
      };
      return {
        ...ref,
        qty: c.qty,
        bits: offer(ref, book.policy),
        history: series.get(key) ?? [],
      };
    });
    const now = new Date(),
      day = now.toISOString().slice(0, 10);
    const data = portfolio(holdings, [], now.toISOString());
    const mark = {
      at: now,
      bits: data.priced === data.count ? data.bits : null,
      market: allowMarket && data.marked === data.count ? data.market : null,
    };
    await tx.cardbitVaultMark.upsert({
      where: {
        shop_customer_source_day: { shop, customer: customerId, source, day },
      },
      create: { shop, customer: customerId, source, day, ...mark },
      update: mark,
    });
    const marks = await tx.cardbitVaultMark.findMany({
      where: { shop, customer: customerId, source },
      orderBy: { day: "asc" },
    });
    data.history = marks.map((m) => ({
      at: m.at.toISOString(),
      bits: m.bits,
      market: allowMarket ? m.market : null,
    }));
    return {
      ...data,
      marketApproved: allowMarket,
      market: allowMarket ? data.market : null,
    };
  });
}
