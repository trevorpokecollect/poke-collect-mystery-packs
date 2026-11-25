// Stock desk operations shared by /staff/stock (site staff) and /internal/site-stock (Card Broker).
import type { Prisma, PrismaClient } from "@prisma/client";
import { priceKey, shelfAddress } from "./stock.server";

export const STOCK_STATUSES = ["FOR_SALE", "POOLED", "VAULTED", "SHIP_LOCKED", "SHIPPED", "REMOVED"] as const;

export class DeskError extends Error {}

const bits = (v: unknown, label: string) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[, ]/g, ""));
  if (!Number.isSafeInteger(n) || n <= 0 || n > 10_000_000) throw new DeskError(`${label} must be a whole number of Cardbits.`);
  return n;
};

/** Price for one printing in one condition. null = no current price/offer (single not sold / no buyback). */
export async function setPrice(db: PrismaClient, actor: string, printingKey: string, condition: string, retail: unknown, buyback: unknown) {
  if (!printingKey || printingKey.length > 500) throw new DeskError("Missing printing.");
  if (!condition || condition.length > 60) throw new DeskError("Missing condition.");
  const retailBits = bits(retail, "Price");
  const buybackBits = bits(buyback, "Buyback");
  if (retailBits != null && buybackBits != null && buybackBits > retailBits) throw new DeskError("Buyback can't be higher than the price.");
  const key = priceKey(printingKey, condition);
  const copies = await db.siteCopy.findMany({ where: { printingKey }, select: { condition: true }, distinct: ["condition"] });
  if (!copies.some((c) => priceKey(printingKey, c.condition) === key)) throw new DeskError("No copies of that printing in that condition.");
  return db.sitePrice.upsert({
    where: { printingKey: key },
    create: { printingKey: key, retailBits, buybackBits, source: actor },
    update: { retailBits, buybackBits, source: actor },
  });
}

/** Move FOR_SALE copies into a pack pool, or POOLED copies back to the shop. Returns how many moved. */
export async function movePool(db: PrismaClient, actor: string, copyIds: string[], packId: string | null) {
  const ids = [...new Set(copyIds.filter((x) => typeof x === "string" && x.length <= 60))].slice(0, 500);
  if (!ids.length) throw new DeskError("Select cards first.");
  if (packId && !(await db.sitePack.findUnique({ where: { id: packId } }))) throw new DeskError("Choose a pack.");
  const from = packId ? "FOR_SALE" : "POOLED";
  const to = packId ? "POOLED" : "FOR_SALE";
  return db.$transaction(async (tx) => {
    const rows = await tx.siteCopy.findMany({ where: { id: { in: ids }, status: from, ownerId: null } });
    for (const r of rows) {
      await tx.siteCopy.update({ where: { id: r.id }, data: { status: to, packId } });
      await tx.siteCopyEvent.create({
        data: { copyId: r.id, fromStatus: from, toStatus: to, actor, reason: packId ? `added to ${packId} pool` : "returned to shop" },
      });
    }
    return { moved: rows.length, skipped: ids.length - rows.length };
  });
}

export async function savePack(db: PrismaClient, id: string, price: unknown, cardsPerPack: unknown, active: boolean) {
  const priceBits = bits(price, "Pack price");
  const n = Number(cardsPerPack);
  if (!priceBits || !Number.isInteger(n) || n < 1 || n > 20) throw new DeskError("Check the pack price and cards per pack.");
  if (!(await db.sitePack.findUnique({ where: { id } }))) throw new DeskError("Unknown pack.");
  return db.sitePack.update({ where: { id }, data: { priceBits, cardsPerPack: n, active } });
}

export type StockQuery = { status?: string; q?: string; cursor?: string; limit?: number; slot?: number };

export async function listStock(db: PrismaClient, query: StockQuery) {
  const status = (STOCK_STATUSES as readonly string[]).includes(query.status || "") ? query.status : undefined;
  const q = (query.q || "").trim().slice(0, 100);
  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
  const where: Prisma.SiteCopyWhereInput = {
    ...(status ? { status } : {}),
    ...(Number.isInteger(query.slot) ? { slot: query.slot } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { setName: { contains: q, mode: "insensitive" } }, { number: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [rows, counts, total, packs, poolCounts] = await Promise.all([
    db.siteCopy.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    }),
    db.siteCopy.groupBy({ by: ["status"], _count: { _all: true } }),
    db.siteCopy.count({ where }),
    db.sitePack.findMany({ orderBy: { sortOrder: "asc" } }),
    db.siteCopy.groupBy({ by: ["packId"], where: { status: "POOLED" }, _count: { _all: true } }),
  ]);
  const page = rows.slice(0, limit);
  const prices = new Map(
    (await db.sitePrice.findMany({ where: { printingKey: { in: [...new Set(page.map((r) => priceKey(r.printingKey, r.condition)))] } } })).map((p) => [p.printingKey, p]),
  );
  const byStatus = Object.fromEntries(STOCK_STATUSES.map((s) => [s, counts.find((c) => c.status === s)?._count._all ?? 0])) as Record<string, number>;
  const next = rows.length > limit ? page[page.length - 1].id : null;
  return {
    total,
    counts: byStatus,
    totals: { all: Object.values(byStatus).reduce((a, b) => a + b, 0), ...byStatus }, // ignore filters
    nextCursor: next,
    next,
    packs: packs.map((p) => {
      const pooled = poolCounts.find((c) => c.packId === p.id)?._count._all ?? 0;
      return { id: p.id, title: p.title, priceBits: p.priceBits, cardsPerPack: p.cardsPerPack, active: p.active, pooled, packsAvailable: Math.floor(pooled / p.cardsPerPack) };
    }),
    copies: page.map((r) => {
      const p = prices.get(priceKey(r.printingKey, r.condition));
      const where = r.slot != null ? shelfAddress(r.slot) : null;
      return {
        id: r.id,
        receiptKey: r.receiptKey,
        printingKey: r.printingKey,
        tcgplayerId: r.tcgplayerId,
        title: r.title,
        game: r.game,
        setName: r.setName,
        number: r.number,
        name: r.name,
        finish: r.finish,
        language: r.language,
        condition: r.condition,
        image: r.image,
        status: r.status,
        demo: r.demo,
        packId: r.packId,
        owned: Boolean(r.ownerId),
        shelf: where?.shelf ?? null,
        box: where?.box ?? null,
        slot: r.slot,
        pocket: r.pocket,
        priceBits: r.retailBits ?? p?.retailBits ?? null,
        retailBits: r.retailBits ?? p?.retailBits ?? null,
        buybackBits: p?.buybackBits ?? null,
        priceSource: r.retailBits != null ? "copy" : p?.source ?? null,
        priceUpdatedAt: p?.updatedAt.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    }),
  };
}
