// Stock desk operations shared by /staff/stock (site staff) and /internal/site-stock (Card Broker).
import type { Prisma, PrismaClient } from "@prisma/client";
import { POCKETS_PER_SLOT, ROWS_PER_BOX, SITE_FIRST_SLOT, SLOTS_PER_ROW, faceKey, legacyPrintingKey, lookKey, priceKey, printingKey, shelfAddress, shelfLabel } from "./stock.server";
import { RestockError, stageRestock } from "./restock.server";
import { cardImage } from "./card-image";

export const STOCK_STATUSES = ["DRAFT", "FOR_SALE", "POOLED", "VAULTED", "SHIP_LOCKED", "SHIPPED", "REMOVED"] as const;

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

/**
 * Pools fill only from Draft (Trevor, Nov 24) and change only through published restocks (Trevor, Nov 25):
 * "pool" stages DRAFT copies to add to the pack's next restock; "unpool" stages POOLED copies to come out.
 * Nothing changes in a live pool until staff publish the restock (restock.server.ts).
 */
export async function movePool(db: PrismaClient, actor: string, copyIds: string[], packId: string | null) {
  try {
    if (packId) return await stageRestock(db, actor, packId, copyIds, "add");
    const ids = [...new Set((Array.isArray(copyIds) ? copyIds : []).filter((x) => typeof x === "string" && x.length <= 60))].slice(0, 500);
    if (!ids.length) throw new DeskError("Select cards first.");
    const rows = await db.siteCopy.findMany({ where: { id: { in: ids }, status: "POOLED", packId: { not: null } }, select: { id: true, packId: true } });
    let staged = 0;
    for (const pack of new Set(rows.map((r) => r.packId!))) {
      staged += (await stageRestock(db, actor, pack, rows.filter((r) => r.packId === pack).map((r) => r.id), "remove")).staged;
    }
    return { staged, moved: staged, skipped: ids.length - staged };
  } catch (e) {
    if (e instanceof RestockError) throw new DeskError(e.message);
    throw e;
  }
}

/** Make Draft copies Active (FOR_SALE singles), or take unsold Active copies back to Draft. */
export async function setListing(db: PrismaClient, actor: string, copyIds: string[], active: boolean) {
  return moveCopies(db, actor, copyIds, active ? "DRAFT" : "FOR_SALE", active ? "FOR_SALE" : "DRAFT", null, active ? "made active" : "moved to drafts");
}

async function moveCopies(db: PrismaClient, actor: string, copyIds: string[], from: string, to: string, packId: string | null, reason: string) {
  const ids = [...new Set((Array.isArray(copyIds) ? copyIds : []).filter((x) => typeof x === "string" && x.length <= 60))].slice(0, 500);
  if (!ids.length) throw new DeskError("Select cards first.");
  return db.$transaction(async (tx) => {
    // Copies staged in a restock are locked to it until they're unstaged or published.
    const rows = await tx.siteCopy.findMany({ where: { id: { in: ids }, status: from, ownerId: null, restockId: null }, select: { id: true } });
    let moved = 0;
    for (const r of rows) {
      const n = await tx.siteCopy.updateMany({ where: { id: r.id, status: from, ownerId: null, restockId: null }, data: { status: to, packId, autoRestock: false } });
      if (!n.count) continue;
      moved++;
      await tx.siteCopyEvent.create({ data: { copyId: r.id, fromStatus: from, toStatus: to, actor, reason } });
    }
    return { moved, skipped: ids.length - moved };
  });
}

const SITE_LAST_SLOT = 99_999;
const idList = (copyIds: unknown) =>
  [...new Set((Array.isArray(copyIds) ? copyIds : []).filter((x): x is string => typeof x === "string" && x.length <= 60))].slice(0, 500);

/** Why a copy can't be deleted from stock, or null when it can (Trevor, Nov 25: delete inventory from the Inventory tab). */
function cantDelete(c: { status: string; ownerId: string | null; restockId: string | null; orderId: string | null; packId: string | null }) {
  if (c.status === "REMOVED") return "already deleted";
  if (c.restockId) return "staged for a restock (unstage it first)";
  if (c.status === "POOLED" || c.packId) return "in a pack pool (stage it to leave the pool and publish first)";
  if (c.status === "VAULTED" || c.ownerId) return "in a customer's vault";
  if (c.status === "SHIP_LOCKED") return "locked for a shipment";
  if (c.status === "SHIPPED") return "already shipped";
  if (c.orderId) return "on an order";
  if (c.status !== "DRAFT" && c.status !== "FOR_SALE") return "not in Drafts or Active";
  return null;
}

/**
 * Deletes unsold Draft/Active copies: they become REMOVED (kept for the record, hidden from All), leave their pocket so
 * the slot can be reused, and each gets a SiteCopyEvent with who and why. Pooled, staged, vaulted, shipping and sold
 * copies are never touched and come back in `blocked` with the reason.
 */
export async function removeCopies(db: PrismaClient, actor: string, copyIds: unknown, reason: unknown) {
  const ids = idList(copyIds);
  if (!ids.length) throw new DeskError("Select cards first.");
  const why = String(reason ?? "").trim().slice(0, 200) || "no reason given";
  return db.$transaction(async (tx) => {
    const rows = await tx.siteCopy.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, status: true, ownerId: true, restockId: true, orderId: true, packId: true, slot: true, pocket: true },
    });
    const blocked: { id: string; title: string; reason: string }[] = [];
    let removed = 0;
    for (const c of rows) {
      const no = cantDelete(c);
      if (no) {
        blocked.push({ id: c.id, title: c.title, reason: no });
        continue;
      }
      // Guarded again in the update, so a copy sold or pooled a moment ago is left alone.
      const n = await tx.siteCopy.updateMany({
        where: { id: c.id, status: c.status, ownerId: null, restockId: null, orderId: null, packId: null },
        data: { status: "REMOVED", slot: null, pocket: null, autoRestock: false },
      });
      if (!n.count) {
        blocked.push({ id: c.id, title: c.title, reason: "changed while deleting; refresh and try again" });
        continue;
      }
      removed++;
      const was = c.slot != null ? ` (was slot ${c.slot}${c.pocket ? ` pocket ${c.pocket}` : ""})` : "";
      await tx.siteCopyEvent.create({ data: { copyId: c.id, fromStatus: c.status, toStatus: "REMOVED", actor, reason: `deleted: ${why}${was}` } });
    }
    const missing = ids.length - rows.length;
    return { removed, blocked, missing, skipped: blocked.length + missing };
  });
}

/**
 * Moves one copy to a chosen slot (and pocket, or the first free one). Same rules as receiving: slots 10001 and up,
 * 20 pockets, and a slot holds one copy of a printing and one card per name, so lookalikes never share a slot.
 */
/**
 * Fix a copy listed under the wrong TCGplayer product (Trevor, Nov 25 2026: regular Nidorina 101 and Flutter Mane 097
 * copies were listed as their Pokémon Center Exclusive lookalikes). Card Broker sends the right catalog product; it must
 * be the same set, number, finish and language, so the copy stays the same physical card in the same slot. Only unsold
 * Draft or Active copies outside any pool or restock. The copy takes the new product's price key (Card Broker's next
 * price sync, or the price sent here, sets its price). Logged.
 */
export async function relinkCopy(
  db: PrismaClient,
  actor: string,
  copyId: unknown,
  product: Record<string, unknown> | null | undefined,
) {
  const id = typeof copyId === "string" && copyId.length <= 60 ? copyId : "";
  if (!id) throw new DeskError("Choose a card first.");
  const p = product ?? {};
  const text = (k: string, max: number) => {
    const v = p[k];
    if (typeof v !== "string" || !v.trim() || v.length > max) throw new DeskError(`Missing ${k}.`);
    return v.trim();
  };
  const tcgplayerId = p.tcgplayerId;
  if (!Number.isSafeInteger(tcgplayerId) || (tcgplayerId as number) < 1) throw new DeskError("Choose the TCGplayer product.");
  const image = p.image == null || p.image === "" ? null : p.image;
  if (image !== null && (typeof image !== "string" || !/^https:\/\//.test(image) || image.length > 2000)) throw new DeskError("Image must be an https URL.");
  const next = {
    game: text("game", 40), setName: text("setName", 350), number: text("number", 60), finish: text("finish", 80), language: text("language", 60),
    name: text("name", 350), title: text("title", 500), tcgplayerId: tcgplayerId as number, image: cardImage({ image: image as string | null, tcgplayerId: tcgplayerId as number }),
  };
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('cardbit-site-shelf', 0))::text`;
    const c = await tx.siteCopy.findUnique({ where: { id } });
    if (!c) throw new DeskError("That card isn't in cardbit.com stock.");
    if (!["DRAFT", "FOR_SALE"].includes(c.status) || c.ownerId || c.orderId || c.packId || c.restockId)
      throw new DeskError("Only unsold Draft or Active cards outside pack pools and restocks can be switched. Unpool it first.");
    if (lookKey(c) !== lookKey(next) || legacyPrintingKey(c) !== legacyPrintingKey(next))
      throw new DeskError("The new product must be the same set, number, finish and language as the card on the shelf.");
    if (c.tcgplayerId === next.tcgplayerId && c.name === next.name) return { id: c.id, switched: false, printingKey: c.printingKey, condition: c.condition };
    const face = faceKey(next.name);
    if (c.slot != null && face !== c.faceKey) {
      const twin = await tx.siteCopy.findFirst({ where: { slot: c.slot, faceKey: face, id: { not: c.id } }, select: { id: true } });
      if (twin) throw new DeskError(`${shelfLabel(c.slot)} already holds a ${next.name}. Move this card to another slot first.`);
    }
    const key = printingKey(next);
    await tx.siteCopy.update({
      where: { id: c.id },
      data: { tcgplayerId: next.tcgplayerId, name: next.name, title: next.title, image: next.image, faceKey: face, printingKey: key },
    });
    await tx.siteCopyEvent.create({
      data: { copyId: c.id, fromStatus: c.status, toStatus: c.status, actor, reason: `switched product from TCGplayer ${c.tcgplayerId ?? "none"} "${c.name}" to ${next.tcgplayerId} "${next.name}"`.slice(0, 500) },
    });
    return { id: c.id, switched: true, printingKey: key, condition: c.condition };
  });
}

export async function moveToSlot(db: PrismaClient, actor: string, copyId: unknown, slotIn: unknown, pocketIn: unknown) {
  const id = typeof copyId === "string" && copyId.length <= 60 ? copyId : "";
  if (!id) throw new DeskError("Choose a card first.");
  const slot = Number(slotIn);
  if (!Number.isInteger(slot) || slot < SITE_FIRST_SLOT || slot > SITE_LAST_SLOT) throw new DeskError("Choose a Box, Row and Slot on the cardbit.com shelf.");
  const wantPocket = pocketIn === null || pocketIn === undefined || pocketIn === "" ? null : Number(pocketIn);
  if (wantPocket !== null && (!Number.isInteger(wantPocket) || wantPocket < 1 || wantPocket > POCKETS_PER_SLOT)) throw new DeskError(`Card position must be 1 to ${POCKETS_PER_SLOT}, or blank for the first free one.`);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('cardbit-site-shelf', 0))::text`;
    const c = await tx.siteCopy.findUnique({ where: { id } });
    if (!c) throw new DeskError("That card isn't in cardbit.com stock.");
    if (c.status === "SHIP_LOCKED") throw new DeskError("That card is locked for a shipment. Move it after the shipment is packed or released.");
    if (c.status === "SHIPPED" || c.status === "REMOVED") throw new DeskError("That card isn't on the shelf any more.");
    const others = await tx.siteCopy.findMany({ where: { slot, id: { not: c.id } }, select: { pocket: true, lookKey: true, faceKey: true, name: true } });
    if (others.some((o) => o.lookKey === c.lookKey)) throw new DeskError(`${shelfLabel(slot)} already holds a copy of this printing. Choose another slot.`);
    const twin = others.find((o) => o.faceKey === c.faceKey);
    if (twin) throw new DeskError(`${shelfLabel(slot)} already holds a ${twin.name}. A slot holds one card per name, so choose another slot.`);
    if (others.length >= POCKETS_PER_SLOT) throw new DeskError(`${shelfLabel(slot)} is full (${POCKETS_PER_SLOT} cards).`);
    const taken = new Set(others.map((o) => o.pocket));
    let pocket = wantPocket ?? 1;
    if (wantPocket !== null) {
      if (taken.has(wantPocket)) throw new DeskError(`Card ${wantPocket} in ${shelfLabel(slot)} is taken. Leave it blank to use the first free spot.`);
    } else while (taken.has(pocket)) pocket++;
    if (c.slot === slot && c.pocket === pocket) return { id: c.id, slot, pocket, moved: false };
    await tx.siteCopy.update({ where: { id: c.id }, data: { slot, pocket } });
    const from = c.slot != null ? `slot ${c.slot}${c.pocket ? ` pocket ${c.pocket}` : ""}` : "no slot";
    await tx.siteCopyEvent.create({ data: { copyId: c.id, fromStatus: c.status, toStatus: c.status, actor, reason: `moved from ${from} to slot ${slot} pocket ${pocket}` } });
    return { id: c.id, slot, pocket, moved: true };
  });
}

/** Cards and slots used per row (box + row), for Card Broker's box/row claiming. Only rows holding cards are listed. */
export async function boxSummary(db: PrismaClient) {
  const rows = await db.$queryRaw<{ r: number; cards: bigint; slots: bigint }[]>`
    SELECT (slot - ${SITE_FIRST_SLOT}) / ${SLOTS_PER_ROW} AS r, sum(n) AS cards, count(*) AS slots
    FROM (SELECT slot, count(*) AS n FROM "SiteCopy" WHERE slot >= ${SITE_FIRST_SLOT} GROUP BY slot) s
    GROUP BY 1 ORDER BY 1`;
  return rows.map((x) => ({
    box: Math.floor(Number(x.r) / ROWS_PER_BOX) + 1,
    row: (Number(x.r) % ROWS_PER_BOX) + 1,
    cards: Number(x.cards),
    slotsUsed: Number(x.slots),
  }));
}

export async function savePack(db: PrismaClient, id: string, price: unknown, cardsPerPack: unknown, active: boolean) {
  const priceBits = bits(price, "Pack price");
  const n = Number(cardsPerPack);
  if (!priceBits || !Number.isInteger(n) || n < 1 || n > 20) throw new DeskError("Check the pack price and cards per pack.");
  const pack = await db.sitePack.findUnique({ where: { id } });
  if (!pack) throw new DeskError("Unknown pack.");
  if (pack.kind !== "pack") throw new DeskError("Prize pools (Daily Spins, Spark Shop) aren't sold, so they have no price or On Sale switch.");
  return db.sitePack.update({ where: { id }, data: { priceBits, cardsPerPack: n, active } });
}

export type StockQuery = { status?: string; q?: string; cursor?: string; limit?: number; slot?: number };

export async function listStock(db: PrismaClient, query: StockQuery) {
  const status = (STOCK_STATUSES as readonly string[]).includes(query.status || "") ? query.status : undefined;
  const q = (query.q || "").trim().slice(0, 100);
  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
  const where: Prisma.SiteCopyWhereInput = {
    // Deleted copies show only under the Removed filter.
    ...(status ? { status } : { status: { not: "REMOVED" } }),
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
    totals: { all: Object.values(byStatus).reduce((a, b) => a + b, 0) - (byStatus.REMOVED ?? 0), ...byStatus }, // ignore filters; All leaves out deleted
    nextCursor: next,
    next,
    value: await stockValue(db), // ignores filters
    packs: packs.map((p) => {
      const pooled = poolCounts.find((c) => c.packId === p.id)?._count._all ?? 0;
      return { id: p.id, title: p.title, kind: p.kind, priceBits: p.priceBits, cardsPerPack: p.cardsPerPack, active: p.active, pooled, packsAvailable: Math.floor(pooled / p.cardsPerPack) };
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
        staged: r.restockId != null, // locked in a pack's pending restock
        autoRestock: r.autoRestock, // sold back, waiting for the hourly automatic restock
        owned: Boolean(r.ownerId),
        shelf: where?.shelf ?? null,
        row: where?.row ?? null,
        rowSlot: where?.rowSlot ?? null,
        place: r.slot != null ? shelfLabel(r.slot, r.pocket) : null,
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

type Value = { copies: number; demo: number; retailBits: number; buybackBits: number; unpriced: number };
/** Cardbits value of all stock by status: price = copy override, else the printing+condition price. */
export async function stockValue(db: PrismaClient) {
  const groups = await db.siteCopy.groupBy({
    by: ["status", "printingKey", "condition", "demo"],
    _count: { _all: true, retailBits: true },
    _sum: { retailBits: true },
  });
  const prices = new Map(
    (await db.sitePrice.findMany({ where: { printingKey: { in: [...new Set(groups.map((g) => priceKey(g.printingKey, g.condition)))] } } })).map((p) => [p.printingKey, p]),
  );
  const out: Record<string, Value> = {};
  for (const g of groups) {
    const v = (out[g.status] ??= { copies: 0, demo: 0, retailBits: 0, buybackBits: 0, unpriced: 0 });
    const p = prices.get(priceKey(g.printingKey, g.condition));
    const n = g._count._all,
      own = g._count.retailBits;
    v.copies += n;
    if (g.demo) v.demo += n;
    v.retailBits += (g._sum.retailBits ?? 0) + (p?.retailBits != null ? p.retailBits * (n - own) : 0);
    if (p?.retailBits == null) v.unpriced += n - own;
    v.buybackBits += (p?.buybackBits ?? 0) * n;
  }
  return out;
}
