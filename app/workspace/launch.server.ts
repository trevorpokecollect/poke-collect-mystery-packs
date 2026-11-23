import type { Prisma, PrismaClient } from "@prisma/client";
import type { AdminApiContext as Admin } from "@shopify/shopify-app-react-router/server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import {
  availableAt,
  ledgerFor,
  moveQuantities,
} from "../lib/inventory.server";
import { gql } from "../lib/orders.server";
import { launchSeriesInTransaction } from "../lib/pool.server";
import { lockPackVariantDraft } from "../lib/series-draft-lock.server";
import { asJson, lockBook, readBook } from "./book.server";
import {
  details,
  draftRevision,
  seriesFilter,
  toView,
  verifyWorkspaceLaunch,
} from "./pools.server";

type Tx = Prisma.TransactionClient;
type Move = {
  cardId: string;
  inventoryItemId: string;
  locationId: string;
  quantity: number;
  expectedAvailable: number;
};
const read = (db: Tx | PrismaClient, id: string) =>
  db.series.findFirstOrThrow({
    where: { ...seriesFilter(), id },
    include: details,
  });
const lockSeries = (tx: Tx, id: string) =>
  tx.$queryRaw`SELECT id FROM "Series" WHERE id=${id} FOR UPDATE`;

async function verifyWalletChannel(admin: Admin, id: string) {
  const data = await gql(
    admin,
    `#graphql
    query WalletPackChannel($id:ID!){productVariant(id:$id){inventoryPolicy inventoryItem{tracked inventoryLevels(first:50){
      pageInfo{hasNextPage} nodes{quantities(names:["available"]){quantity}}}}}}`,
    { id },
  );
  const variant = data.productVariant;
  if (
    !variant?.inventoryItem.tracked ||
    variant.inventoryPolicy !== "DENY" ||
    !variant.inventoryItem.inventoryLevels.nodes.length ||
    variant.inventoryItem.inventoryLevels.pageInfo.hasNextPage ||
    variant.inventoryItem.inventoryLevels.nodes.some(
      (l: { quantities: { quantity: number }[] }) =>
        l.quantities[0]?.quantity !== 0,
    )
  )
    throw Error(
      "Close the prior Shopify series and set this pack's tracked Shopify checkout inventory to zero at every location before launching a Cardbits pool.",
    );
}
async function balancedMoves(admin: Admin, moves: Move[]) {
  const quantities = await availableAt(admin, moves);
  return moves.map((m) => {
    const quantity = quantities.get(m.inventoryItemId + "|" + m.locationId);
    if (quantity === undefined || quantity < m.quantity)
      throw Error(
        "These singles no longer have enough available stock. Review the reservation in Cardbit.",
      );
    return { ...m, expectedAvailable: quantity };
  });
}
// Save every batch before its first Shopify call. One transaction per batch keeps large pools resumable.
export async function launchWalletPool(
  db: PrismaClient,
  admin: Admin,
  id: string,
  revision: string,
) {
  const draft = await read(db, id);
  if (draft.commitHash) {
    if (
      !(await db.cardbitLaunchBatch.findFirst({
        where: { seriesId: id, revision },
      }))
    )
      throw Error("This series has already launched with another revision.");
    return toView(draft);
  }
  if (draft.status !== "DRAFT" || draftRevision(draft) !== revision)
    throw Error("Your draft changed. Refresh and review it again.");
  await verifyWorkspaceLaunch(db, admin, id);
  await verifyWalletChannel(admin, draft.packVariantId);
  await db.$transaction(
    async (tx) => {
      await lockPackVariantDraft(tx, shop, draft.packVariantId);
      await lockSeries(tx, id);
      const existing = await tx.cardbitLaunchBatch.findFirst({
        where: { seriesId: id },
      });
      if (existing) {
        if (existing.cancelling)
          throw Error("Discard is in progress. Resume discarding this draft.");
        if (existing.revision !== revision)
          throw Error(
            "A reservation already exists for another draft revision.",
          );
        return;
      }
      const fresh = await read(tx, id);
      if (fresh.status !== "DRAFT" || draftRevision(fresh) !== revision)
        throw Error("Your draft changed. Refresh and review it again.");
      const other = await tx.series.findFirst({
        where: {
          shop,
          packVariantId: draft.packVariantId,
          status: "LIVE",
          id: { not: id },
        },
      });
      if (other)
        throw Error(
          "Close the current live series for this edition before launching another.",
        );
      const cards = await tx.card.findMany({
        where: { seriesId: id },
        orderBy: { id: "asc" },
      });
      if (
        !cards.length ||
        cards.some(
          (c) =>
            !c.inventoryItemId ||
            !c.locationId ||
            c.quantity < 1 ||
            c.reservedQty !== 0,
        ) ||
        cards.reduce((a, c) => a + c.quantity, 0) % fresh.cardsPerPack
      )
        throw Error("Review the draft's physical quantities and pack size.");
      const moves: Move[] = cards.map((c) => ({
        cardId: c.id,
        inventoryItemId: c.inventoryItemId!,
        locationId: c.locationId!,
        quantity: c.quantity,
        expectedAvailable: 0,
      }));
      if (
        new Set(moves.map((m) => m.inventoryItemId + "|" + m.locationId))
          .size !== moves.length
      )
        throw Error("Combine duplicated inventory rows before launching.");
      const planned = await balancedMoves(admin, moves);
      for (let offset = 0; offset < planned.length; offset += 100)
        await tx.cardbitLaunchBatch.create({
          data: {
            seriesId: id,
            index: offset / 100,
            revision,
            moves: asJson(planned.slice(offset, offset + 100)),
          },
        });
    },
    { timeout: 120000 },
  );
  const batches = await db.cardbitLaunchBatch.findMany({
    where: { seriesId: id },
    orderBy: { index: "asc" },
  });
  for (const batch of batches) {
    if (batch.confirmedAt) continue;
    const where = { seriesId_index: { seriesId: id, index: batch.index } };
    // Commit the first-attempt time independently so a lost response cannot restart the replay clock.
    await db.cardbitLaunchBatch.updateMany({
      where: {
        seriesId: id,
        index: batch.index,
        attemptedAt: null,
        confirmedAt: null,
      },
      data: { attemptedAt: new Date() },
    });
    const result = await db.$transaction(
      async (tx) => {
        await lockSeries(tx, id);
        const row = await tx.cardbitLaunchBatch.findUniqueOrThrow({ where });
        if (row.cancelling)
          throw Error("Discard is in progress. Resume discarding this draft.");
        if (row.confirmedAt) return true;
        if (
          !row.attemptedAt ||
          Date.now() - row.attemptedAt.getTime() > 20 * 3600000
        )
          throw Error(
            "This reservation needs an inventory reconciliation before it can be replayed.",
          );
        const moves = row.moves as unknown as Move[];
        try {
          await moveQuantities(
            admin,
            moves,
            "reserve",
            ledgerFor(id),
            `cb-pool-${id}-${row.index}-${row.generation}`,
          );
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !/change.from.quantity.*(stale|match)|compare.quantity.*(stale|match)|quantity.*does not match/i.test(
              error.message,
            )
          )
            throw error;
          // Shopify explicitly declined this comparison. Only this batch can be replanned.
          const next = await balancedMoves(admin, moves);
          await tx.cardbitLaunchBatch.update({
            where,
            data: {
              moves: asJson(next),
              generation: { increment: 1 },
              attemptedAt: null,
            },
          });
          return false;
        }
        for (const m of moves)
          await tx.card.update({
            where: { id: m.cardId },
            data: { reservedQty: m.quantity },
          });
        await tx.cardbitLaunchBatch.update({
          where,
          data: { confirmedAt: new Date() },
        });
        return true;
      },
      { timeout: 120000 },
    );
    if (!result)
      throw Error(
        "Stock changed during reservation. Review the draft and retry to resume this batch.",
      );
  }
  return db.$transaction(
    async (tx) => {
      await lockPackVariantDraft(tx, shop, draft.packVariantId);
      await lockSeries(tx, id);
      const fresh = await read(tx, id);
      if (fresh.commitHash) return toView(fresh);
      if (
        fresh.status !== "DRAFT" ||
        draftRevision(fresh) !== revision ||
        (await tx.cardbitLaunchBatch.count({
          where: {
            seriesId: id,
            OR: [{ confirmedAt: null }, { cancelling: true }],
          },
        }))
      )
        throw Error("Physical reservation is incomplete or the draft changed.");
      await lockBook(tx);
      const book = await readBook(tx);
      if (
        fresh.cards.some((c) => {
          const ref = book.refs[book.variants[c.variantId]];
          return (
            !ref?.cash ||
            ref.quoteSource !== "merchant" ||
            ref.retail !== Math.round(Number(c.marketValue) * 100)
          );
        })
      )
        throw Error(
          "Pricing changed during reservation. Review the reserved draft before launch.",
        );
      const other = await tx.series.findFirst({
        where: {
          shop,
          packVariantId: fresh.packVariantId,
          status: "LIVE",
          id: { not: id },
        },
      });
      if (other) throw Error("Another series is live for this edition.");
      await tx.series.update({
        where: { id },
        data: {
          buildRules: asJson({
            ...(fresh.buildRules as object),
            cardbitSalesChannel: "wallet",
          }),
        },
      });
      await launchSeriesInTransaction(tx, id);
      return toView(await read(tx, id));
    },
    { timeout: 120000 },
  );
}

// A partially reserved draft can be discarded. Resolve an uncertain reserve before releasing it.
export async function discardWalletDraft(
  db: PrismaClient,
  admin: Admin,
  id: string,
) {
  const batches = await db.$transaction(async (tx) => {
    await lockSeries(tx, id);
    const draft = await read(tx, id);
    if (draft.status !== "DRAFT") throw Error("Only a draft can be discarded.");
    const rows = await tx.cardbitLaunchBatch.findMany({
      where: { seriesId: id },
      orderBy: { index: "asc" },
    });
    if (!rows.length) {
      if (
        await tx.card.count({ where: { seriesId: id, reservedQty: { gt: 0 } } })
      )
        throw Error("Inspect this draft's existing reservations first.");
      await tx.series.delete({ where: { id } });
      return [];
    }
    await tx.cardbitLaunchBatch.updateMany({
      where: { seriesId: id },
      data: { cancelling: true },
    });
    return rows;
  });
  if (!batches.length) return;
  for (const batch of batches) {
    await db.$transaction(
      async (tx) => {
        await lockSeries(tx, id);
        const where = { seriesId_index: { seriesId: id, index: batch.index } };
        const row = await tx.cardbitLaunchBatch.findUnique({ where });
        if (!row || row.releasedAt) return;
        const moves = row.moves as unknown as Move[];
        let reserved = !!row.confirmedAt;
        if (!reserved && row.attemptedAt) {
          if (Date.now() - row.attemptedAt.getTime() > 20 * 3600000)
            throw Error(
              "Reconcile the outstanding Shopify reservation before discarding.",
            );
          try {
            await moveQuantities(
              admin,
              moves,
              "reserve",
              ledgerFor(id),
              `cb-pool-${id}-${row.index}-${row.generation}`,
            );
            reserved = true;
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !/change.from.quantity.*(stale|match)|compare.quantity.*(stale|match)|quantity.*does not match/i.test(
                error.message,
              )
            )
              throw error;
          }
        }
        if (reserved)
          await moveQuantities(
            admin,
            moves.map((m) => ({
              inventoryItemId: m.inventoryItemId,
              locationId: m.locationId,
              quantity: m.quantity,
            })),
            "release",
            ledgerFor(id),
            `cb-release-${id}-${row.index}`,
          );
        await tx.card.updateMany({
          where: { id: { in: moves.map((m) => m.cardId) } },
          data: { reservedQty: 0 },
        });
        await tx.cardbitLaunchBatch.update({
          where,
          data: { releasedAt: new Date() },
        });
      },
      { timeout: 120000 },
    );
  }
  await db.$transaction(async (tx) => {
    await lockSeries(tx, id);
    if (
      await tx.cardbitLaunchBatch.count({
        where: { seriesId: id, releasedAt: null },
      })
    )
      throw Error("Finish releasing inventory before discarding.");
    await tx.cardbitLaunchBatch.deleteMany({ where: { seriesId: id } });
    await tx.series.deleteMany({
      where: {
        ...seriesFilter(),
        id,
        status: "DRAFT",
        cards: { none: { reservedQty: { gt: 0 } } },
      },
    });
  });
}
