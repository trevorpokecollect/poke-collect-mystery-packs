// Reference CopyStore using conditional UPDATEs, written against the SiteCopy columns in
// docs/CARDBIT-SITE.md (id, status, ownerId). The lead can adopt this as-is once SiteCopy exists,
// or point `table` at it. Tests run it against a scratch table with the same columns.

import type { CopyStore, LockedCopy, Tx } from "./types";
import { CopyLockError } from "./types";

export function sqlCopyStore(table = "SiteCopy"): CopyStore {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error("bad table name");
  const t = `"${table}"`;
  return {
    async lockForShipment(tx: Tx, customerId: string, copyIds: string[], shipmentId: string): Promise<LockedCopy[]> {
      if (copyIds.length === 0) throw new CopyLockError("Pick at least one card.", []);
      const rows = await tx.$queryRawUnsafe<LockedCopy[]>(
        `UPDATE ${t} SET status = 'SHIP_LOCKED', "orderId" = $1, "updatedAt" = now()
         WHERE id = ANY($2::text[]) AND status = 'VAULTED' AND "ownerId" = $3
         RETURNING id, title, slot, pocket`,
        shipmentId,
        copyIds,
        customerId,
      );
      if (rows.length !== copyIds.length) {
        const got = new Set(rows.map((r) => r.id));
        // Throwing rolls back the whole transaction, including the rows we did lock.
        throw new CopyLockError("Some of those cards are no longer in your vault.", copyIds.filter((id) => !got.has(id)));
      }
      return rows;
    },
    async release(tx: Tx, shipmentId: string, copyIds: string[]) {
      await tx.$executeRawUnsafe(
        `UPDATE ${t} SET status = 'VAULTED', "orderId" = NULL, "updatedAt" = now()
         WHERE id = ANY($1::text[]) AND status = 'SHIP_LOCKED' AND "orderId" = $2`,
        copyIds,
        shipmentId,
      );
    },
    async markShipped(tx: Tx, shipmentId: string, copyIds: string[]) {
      await tx.$executeRawUnsafe(
        `UPDATE ${t} SET status = 'SHIPPED', "updatedAt" = now()
         WHERE id = ANY($1::text[]) AND status = 'SHIP_LOCKED' AND "orderId" = $2`,
        copyIds,
        shipmentId,
      );
    },
  };
}
