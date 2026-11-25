// CopyStore on SiteCopy using conditional UPDATEs. Every status change writes a SiteCopyEvent.
// `table` is overridable for tests only.

import type { CopyStore, LockedCopy, Tx } from "./types";
import { CopyLockError } from "./types";

export function sqlCopyStore(table = "SiteCopy", eventTable = "SiteCopyEvent"): CopyStore {
  for (const name of [table, eventTable])
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("bad table name");
  const t = `"${table}"`;
  const ev = `"${eventTable}"`;
  const log = (tx: Tx, ids: string[], from: string | null, to: string, actor: string, reason: string) =>
    tx.$executeRawUnsafe(
      `INSERT INTO ${ev} (id, "copyId", "fromStatus", "toStatus", actor, reason, "createdAt")
       SELECT 'cev_' || md5(random()::text || clock_timestamp()::text || x), x, $2, $3, $4, $5, now()
       FROM unnest($1::text[]) AS x`,
      ids,
      from,
      to,
      actor,
      reason,
    );

  return {
    async lockForShipment(tx, customerId, copyIds, shipmentId): Promise<LockedCopy[]> {
      if (copyIds.length === 0) throw new CopyLockError("Pick at least one card.", []);
      const rows = await tx.$queryRawUnsafe<LockedCopy[]>(
        `UPDATE ${t} SET status = 'SHIP_LOCKED', "orderId" = $1, "updatedAt" = now()
         WHERE id = ANY($2::text[]) AND status = 'VAULTED' AND "ownerId" = $3
         RETURNING id, title, slot, pocket, image`,
        shipmentId,
        copyIds,
        customerId,
      );
      if (rows.length !== copyIds.length) {
        const got = new Set(rows.map((r) => r.id));
        // Throwing rolls back the whole transaction, including the rows we did lock.
        throw new CopyLockError("Some of those cards are no longer in your vault.", copyIds.filter((id) => !got.has(id)));
      }
      await log(tx, copyIds, "VAULTED", "SHIP_LOCKED", `customer:${customerId}`, `shipment ${shipmentId}`);
      return rows;
    },

    async release(tx, shipmentId, copyIds) {
      const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
        `UPDATE ${t} SET status = 'VAULTED', "orderId" = NULL, "updatedAt" = now()
         WHERE id = ANY($1::text[]) AND status = 'SHIP_LOCKED' AND "orderId" = $2 RETURNING id`,
        copyIds,
        shipmentId,
      );
      if (rows.length) await log(tx, rows.map((r) => r.id), "SHIP_LOCKED", "VAULTED", "system", `released from shipment ${shipmentId}`);
    },

    async swapForShipment(tx, shipmentId, customerId, oldCopyId, actor): Promise<LockedCopy> {
      const old = await tx.$queryRawUnsafe<{ printingKey: string; condition: string }[]>(
        `SELECT "printingKey", condition FROM ${t}
         WHERE id = $1 AND status = 'SHIP_LOCKED' AND "orderId" = $2 AND "ownerId" = $3 FOR UPDATE`,
        oldCopyId,
        shipmentId,
        customerId,
      );
      if (!old.length) throw new CopyLockError("That card is no longer on this shipment.", [oldCopyId]);
      // Take the lowest filed spare; SKIP LOCKED so two desks swapping at once get different copies.
      const next = await tx.$queryRawUnsafe<(LockedCopy & { fromStatus: string })[]>(
        `WITH pick AS (
           SELECT id, status FROM ${t}
           WHERE "printingKey" = $1 AND condition = $2 AND status IN ('FOR_SALE', 'DRAFT') AND "ownerId" IS NULL AND slot IS NOT NULL AND id <> $5
           ORDER BY status = 'DRAFT', slot, pocket, id LIMIT 1 FOR UPDATE SKIP LOCKED
         )
         UPDATE ${t} c SET status = 'SHIP_LOCKED', "ownerId" = $3, "orderId" = $4, "updatedAt" = now()
         FROM pick WHERE c.id = pick.id
         RETURNING c.id, c.title, c.slot, c.pocket, c.image, pick.status AS "fromStatus"`,
        old[0].printingKey,
        old[0].condition,
        customerId,
        shipmentId,
        oldCopyId,
      );
      if (!next.length)
        throw new CopyLockError("No other filed copy of this card is available. Remove it from the shipment instead.", [oldCopyId]);
      await tx.$executeRawUnsafe(
        `UPDATE ${t} SET status = 'DRAFT', "ownerId" = NULL, "orderId" = NULL, slot = NULL, pocket = NULL, "updatedAt" = now()
         WHERE id = $1`,
        oldCopyId,
      );
      await log(tx, [next[0].id], next[0].fromStatus, "SHIP_LOCKED", actor, `swap in for ${oldCopyId} on shipment ${shipmentId}`);
      await log(tx, [oldCopyId], "SHIP_LOCKED", "DRAFT", actor, `swapped out of shipment ${shipmentId}; unfiled for inspection`);
      const { fromStatus: _from, ...picked } = next[0];
      return picked;
    },

    async markShipped(tx, shipmentId, copyIds) {
      const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
        `UPDATE ${t} SET status = 'SHIPPED', "updatedAt" = now()
         WHERE id = ANY($1::text[]) AND status = 'SHIP_LOCKED' AND "orderId" = $2 RETURNING id`,
        copyIds,
        shipmentId,
      );
      if (rows.length) await log(tx, rows.map((r) => r.id), "SHIP_LOCKED", "SHIPPED", "system", `shipment ${shipmentId}`);
    },
  };
}
