import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";

type Tx = Prisma.TransactionClient;
export type Intake = {
  eventKey: string;
  variantId: string;
  quantity: number;
  title: string;
  game: string;
  setName: string;
  number: string;
  name: string;
  finish: string;
  language: string;
  condition: string;
  image?: string | null;
  locationId?: string | null;
};
const fold = (s: string) =>
  s.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
export const digest = (s: unknown) =>
  createHash("sha256").update(JSON.stringify(s)).digest("hex");
export const shelfLock = (tx: Tx) =>
  tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"cardbit-shelf/" + shop}, 0))::text`;
export function lookKey(row: Intake) {
  const ident = [
    row.game,
    row.setName,
    row.number,
    row.name,
    row.finish,
    row.language,
  ];
  if (ident.some((x) => typeof x !== "string" || !x.trim() || x.length > 350))
    throw Error(
      "Complete the card's set, number, name, language and finish in Card Broker.",
    );
  return digest([
    fold(row.game).replace(/[- ](japan|japanese|english)$/, ""),
    fold(row.setName),
    fold(row.number)
      .split("/")[0]
      .replace(/^0+(?=\d)/, ""),
  ]);
}
export const faceKey = (name: string) =>
  digest(
    fold(name)
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]/gu, ""),
  );
export const shelfAddress = (slot: number) => ({
  shelf: Math.ceil(slot / 100),
  box: Math.ceil(slot / 20),
  slot,
});
export async function receiveCopies(db: PrismaClient, row: Intake) {
  if (
    !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(row.variantId) ||
    !/^[a-zA-Z0-9:_-]{1,160}$/.test(row.eventKey) ||
    !Number.isInteger(row.quantity) ||
    row.quantity < 1 ||
    row.quantity > 50000 ||
    !row.title?.trim() ||
    !row.condition?.trim() ||
    (row.locationId && !/^gid:\/\/shopify\/Location\/\d+$/.test(row.locationId))
  )
    throw Error("Invalid Card Broker receipt.");
  const key = lookKey(row),
    face = faceKey(row.name),
    fingerprint = digest([
      row.variantId,
      row.quantity,
      key,
      face,
      row.condition,
      row.locationId ?? null,
    ]);
  return db.$transaction(
    async (tx) => {
      await shelfLock(tx);
      const prior = await tx.cardbitShelfReceipt.findUnique({
        where: { shop_eventKey: { shop, eventKey: row.eventKey } },
      });
      if (prior) {
        if (prior.digest !== fingerprint)
          throw Error("This receipt already has different stock details.");
        return { received: prior.quantity, repeated: true };
      }
      const locations = await tx.$queryRaw<{ slot: number; pocket: number }[]>`
      WITH used AS (SELECT slot, count(*) AS n, bool_or("lookKey"=${key} OR "faceKey"=${face}) AS collision,
                      array_agg(pocket) AS taken FROM "CardbitShelfCopy"
                    WHERE shop=${shop} AND slot IS NOT NULL GROUP BY slot),
      choices AS (SELECT n.slot, u.taken FROM generate_series(1,
                  (SELECT greatest(500,coalesce(max(slot),0)) FROM used) + ${row.quantity}::int) n(slot)
                  LEFT JOIN used u ON n.slot=u.slot
                  WHERE coalesce(u.n,0)<20 AND NOT coalesce(u.collision,false)
                  ORDER BY (u.n IS NULL), n.slot LIMIT ${row.quantity})
      SELECT slot, (SELECT n FROM generate_series(1,20) n
                     WHERE NOT n=ANY(coalesce(taken,ARRAY[]::int[])) ORDER BY n LIMIT 1) AS pocket
      FROM choices ORDER BY slot`;
      if (locations.length !== row.quantity)
        throw Error("Could not assign every copy; retry this receipt.");
      await tx.cardbitShelfReceipt.create({
        data: {
          shop,
          eventKey: row.eventKey,
          digest: fingerprint,
          quantity: row.quantity,
        },
      });
      const details = [
        row.setName,
        row.number,
        row.language,
        row.finish,
        row.condition,
      ].join(" · ");
      for (let i = 0; i < locations.length; i += 500) {
        await tx.cardbitShelfCopy.createMany({
          data: locations.slice(i, i + 500).map((address, j) => ({
            shop,
            eventKey: row.eventKey,
            unit: i + j + 1,
            variantId: row.variantId,
            lookKey: key,
            faceKey: face,
            title: row.title,
            details,
            image: row.image || null,
            locationId: row.locationId || null,
            ...address,
          })),
        });
      }
      return { received: row.quantity, repeated: false };
    },
    { timeout: 60000, maxWait: 15000 },
  );
}
export async function shelfPage(
  db: PrismaClient,
  input: { slot?: number; unfiled?: boolean; after?: string },
) {
  const slot = Number(input.slot || 0);
  if (!Number.isInteger(slot) || slot < 0 || slot > 2000000000)
    throw Error("Enter a valid slot number.");
  const where = {
    shop,
    slot: slot || { not: null },
    ...(input.unfiled ? { filedAt: null } : {}),
  };
  const [copies, total, unfiled, occupied] = await Promise.all([
    db.cardbitShelfCopy.findMany({
      where,
      orderBy: [{ slot: "asc" }, { pocket: "asc" }, { id: "asc" }],
      ...(input.after ? { cursor: { id: input.after }, skip: 1 } : {}),
      take: 101,
      select: {
        id: true,
        slot: true,
        title: true,
        details: true,
        image: true,
        filedAt: true,
        parcelId: true,
        poolSlotId: true,
      },
    }),
    db.cardbitShelfCopy.count({ where: { shop, slot: { not: null } } }),
    db.cardbitShelfCopy.count({
      where: { shop, slot: { not: null }, filedAt: null },
    }),
    db.cardbitShelfCopy.aggregate({
      where: { shop },
      _max: { slot: true, lastSlot: true },
    }),
  ]);
  return {
    copies: copies.slice(0, 100),
    next: copies.length > 100 ? copies[99].id : null,
    total,
    unfiled,
    capacity:
      Math.max(500, occupied._max.slot || 0, occupied._max.lastSlot || 0) * 20,
  };
}
export async function confirmFiled(db: PrismaClient, id: string, slot: number) {
  if (!Number.isSafeInteger(slot) || slot < 1)
    throw Error("Confirm its numbered storage slot.");
  const result = await db.cardbitShelfCopy.updateMany({
    where: { id, shop, slot, filedAt: null, shippedAt: null },
    data: { filedAt: new Date() },
  });
  if (
    !result.count &&
    !(await db.cardbitShelfCopy.findFirst({
      where: { id, shop, slot, filedAt: { not: null }, shippedAt: null },
    }))
  )
    throw Error("This card no longer belongs in that slot.");
  return { ok: true };
}
// Expired pool allocations free the copy for sale. Its shelf address stays occupied.
export async function reclaimClosed(tx: Tx) {
  await tx.$executeRaw`UPDATE "CardbitShelfCopy" c SET "poolSlotId"=NULL FROM "Slot" s
    JOIN "Series" p ON p.id=s."seriesId" WHERE c.shop=${shop} AND p.shop=${shop}
      AND c."poolSlotId"=s.id AND c."parcelId" IS NULL AND (s.voided OR (p.status='CLOSED' AND NOT s.claimed))`;
}
export async function bindNativeSlots(
  tx: Tx,
  slotIds: string[],
  paidSingle = false,
) {
  if (!slotIds.length) return;
  await shelfLock(tx);
  if (
    !paidSingle &&
    !(await tx.cardbitShelfReceipt.findFirst({
      where: { shop },
      select: { eventKey: true },
    }))
  )
    return;
  await reclaimClosed(tx);
  const slots = await tx.slot.findMany({
    where: { id: { in: slotIds }, series: { shop } },
    select: {
      id: true,
      card: { select: { variantId: true, locationId: true } },
    },
    orderBy: { id: "asc" },
  });
  if (slots.length !== slotIds.length)
    throw Error("Cardbit could not match every pool copy.");
  const stocks = await tx.cardbitShelfCopy.findMany({
    where: {
      shop,
      slot: { not: null },
      ...(paidSingle ? {} : { filedAt: { not: null } }),
      parcelId: null,
      poolSlotId: null,
      variantId: { in: [...new Set(slots.map((s) => s.card.variantId))] },
    },
    orderBy: [{ slot: "asc" }, { id: "asc" }],
    select: { id: true, variantId: true, locationId: true },
  });
  const grouped = new Map<string, typeof stocks>();
  for (const c of stocks) {
    const k = c.variantId;
    const group = grouped.get(k) || [];
    group.push(c);
    grouped.set(k, group);
  }
  const pairs: { slotId: string; copyId: string }[] = [];
  for (const s of slots) {
    const group = grouped.get(s.card.variantId) || [];
    const index = group.findIndex(
      (c) =>
        !s.card.locationId ||
        !c.locationId ||
        s.card.locationId === c.locationId,
    );
    if (index < 0)
      throw Error(
        "File the required physical copies in Card Broker before allocating this stock.",
      );
    pairs.push({ slotId: s.id, copyId: group.splice(index, 1)[0].id });
  }
  for (let i = 0; i < pairs.length; i += 500) {
    const part = pairs.slice(i, i + 500);
    const rows = Prisma.join(
      part.map((p) => Prisma.sql`(${p.copyId},${p.slotId})`),
    );
    await tx.$executeRaw(
      Prisma.sql`UPDATE "CardbitShelfCopy" c SET "poolSlotId"=v.sid FROM (VALUES ${rows}) v(cid,sid) WHERE c.shop=${shop} AND c.id=v.cid`,
    );
    await tx.cardbitShelfBinding.createMany({
      data: part.map((p) => ({ shop, poolSlotId: p.slotId, copyId: p.copyId })),
    });
  }
}
