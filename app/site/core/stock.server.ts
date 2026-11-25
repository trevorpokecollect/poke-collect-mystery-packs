// Site stock: one SiteCopy row per physical card. Card Broker posts receipts here
// (POST /internal/site-intake). Slots start at 10001 so they never collide with the
// Shopify Cardbit shelf, which shares the same physical boxes (20 per slot, 20 slots per box).
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

export const SITE_FIRST_SLOT = 10001;
export const POCKETS_PER_SLOT = 20;

export type SiteIntake = {
  eventKey: string;
  quantity: number;
  title: string;
  game: string;
  setName: string;
  number: string;
  name: string;
  finish: string;
  language: string;
  condition: string;
  tcgplayerId?: number | null;
  image?: string | null;
};

export class IntakeRejected extends Error {
  constructor(message: string, readonly status: 409 | 422) {
    super(message);
  }
}

const fold = (s: string) => s.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

/** Same printing identity as the production shelf (app/workspace/shelf.server.ts). */
export function lookKey(r: Pick<SiteIntake, "game" | "setName" | "number">) {
  return digest([
    fold(r.game).replace(/[- ](japan|japanese|english)$/, ""),
    fold(r.setName),
    fold(r.number).split("/")[0].replace(/^0+(?=\d)/, ""),
  ]);
}
export const faceKey = (name: string) =>
  digest(fold(name).normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, ""));
export const printingKey = (r: Pick<SiteIntake, "game" | "setName" | "number" | "finish" | "language">) =>
  digest([lookKey(r), fold(r.finish), fold(r.language)]);

/** Price identity: printing AND condition (NM and LP copies are priced separately). */
export const priceKey = (printing: string, condition: string) => `${printing}|${fold(condition)}`;

// Physical layout (Trevor, Nov 25): BCW 5-row boxes, divider every 20 sleeved cards. 20 cards per slot, 30 slots per
// row, 5 rows per box, 2 boxes per shelf; box numbers run on across shelves. Stored slot numbers (10001+) never change.
export const SLOTS_PER_ROW = 30;
export const ROWS_PER_BOX = 5;
export const BOXES_PER_SHELF = 2;
export const shelfAddress = (slot: number) => {
  const i = Math.max(0, slot - SITE_FIRST_SLOT);
  const box = Math.floor(i / (SLOTS_PER_ROW * ROWS_PER_BOX)) + 1;
  return {
    shelf: Math.ceil(box / BOXES_PER_SHELF),
    box,
    row: Math.floor((i % (SLOTS_PER_ROW * ROWS_PER_BOX)) / SLOTS_PER_ROW) + 1,
    rowSlot: (i % SLOTS_PER_ROW) + 1,
    slot,
  };
};
/** "Shelf 1 · Box 1 · Row 1 · Slot 2 · Card 7" for staff, packers and Card Broker messages. */
export const shelfLabel = (slot: number | null, pocket?: number | null) => {
  if (slot == null) return "Not filed";
  const a = shelfAddress(slot);
  return `Shelf ${a.shelf} · Box ${a.box} · Row ${a.row} · Slot ${a.rowSlot}${pocket != null ? ` · Card ${pocket}` : ""}`;
};

export function validateIntake(raw: unknown): SiteIntake {
  const r = raw as Record<string, unknown>;
  const str = (k: string, max = 350) => {
    const v = r?.[k];
    if (typeof v !== "string" || !v.trim() || v.length > max)
      throw new IntakeRejected(`Missing or invalid ${k}.`, 422);
    return v.trim();
  };
  const eventKey = str("eventKey", 160);
  if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(eventKey)) throw new IntakeRejected("Invalid eventKey.", 422);
  const quantity = r.quantity;
  if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > 500)
    throw new IntakeRejected("Quantity must be 1 to 500.", 422);
  const game = str("game", 40);
  if (game !== "pokemon" && game !== "pokemon-japan")
    throw new IntakeRejected("Unknown game. Use pokemon or pokemon-japan.", 422);
  const tcg = r.tcgplayerId;
  if (tcg != null && (!Number.isSafeInteger(tcg) || (tcg as number) < 1))
    throw new IntakeRejected("Invalid tcgplayerId.", 422);
  const image = r.image;
  if (image != null && (typeof image !== "string" || !/^https:\/\//.test(image) || image.length > 2000))
    throw new IntakeRejected("Image must be an https URL.", 422);
  return {
    eventKey,
    quantity: quantity as number,
    title: str("title", 500),
    game,
    setName: str("setName"),
    number: str("number", 60),
    name: str("name"),
    finish: str("finish", 80),
    language: str("language", 60),
    condition: str("condition", 60),
    tcgplayerId: (tcg as number | null | undefined) ?? null,
    image: (image as string | null | undefined) ?? null,
  };
}

type Placed = { id: string; slot: number; pocket: number };
type Reply = { received: number; copies: Placed[] };

/** Idempotent receipt. Same eventKey + same body returns the original reply; a different body is a 409. */
/**
 * Optional Card Broker price on a receipt or price feed, in Cardbits (100 = $1, so cents = Cardbits).
 * Card Broker owns prices; each push replaces the printing's current price and buyback offer.
 */
export function intakePrice(raw: unknown): { retailBits: number | null; buybackBits: number | null } | null {
  const r = raw as Record<string, unknown>;
  if (r?.priceBits === undefined && r?.buybackBits === undefined) return null;
  const v = (k: string) => {
    const x = r[k];
    if (x === null || x === undefined) return null;
    if (!Number.isSafeInteger(x) || (x as number) < 1 || (x as number) > 10_000_000)
      throw new IntakeRejected(`${k} must be a whole number of Cardbits from 1 to 10,000,000, or null.`, 422);
    return x as number;
  };
  const retailBits = v("priceBits");
  const buybackBits = v("buybackBits");
  if (retailBits != null && buybackBits != null && buybackBits > retailBits)
    throw new IntakeRejected("buybackBits can't be higher than priceBits.", 422);
  return { retailBits, buybackBits };
}

export async function applyBrokerPrice(
  db: PrismaClient | Prisma.TransactionClient,
  key: string,
  price: { retailBits: number | null; buybackBits: number | null },
) {
  await db.sitePrice.upsert({
    where: { printingKey: key },
    create: { printingKey: key, ...price, source: "cardbroker" },
    update: { ...price, source: "cardbroker" },
  });
}

export async function receiveSiteIntake(db: PrismaClient, raw: unknown): Promise<Reply> {
  const row = validateIntake(raw);
  const price = intakePrice(raw); // not part of the receipt digest: a re-sent price is not a conflict
  const body = digest(row);
  const reply = await receiveRow(db, row, body);
  if (price) await applyBrokerPrice(db, priceKey(printingKey(row), row.condition), price);
  // Optional era ("Modern" | "Vintage") for pack eligibility; not part of the receipt digest.
  const era = (raw as Record<string, unknown>)?.era;
  if ((era === "Modern" || era === "Vintage") && reply.copies.length)
    await db.siteCopy.updateMany({ where: { id: { in: reply.copies.map((c) => c.id) } }, data: { era } });
  return reply;
}

async function receiveRow(db: PrismaClient, row: SiteIntake, body: string): Promise<Reply> {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('cardbit-site-shelf', 0))::text`;
      const prior = await tx.siteIntakeReceipt.findUnique({ where: { eventKey: row.eventKey } });
      if (prior) {
        if (prior.digest !== body)
          throw new IntakeRejected("This receipt was already recorded with different details.", 409);
        return prior.response as unknown as Reply;
      }
      const look = lookKey(row),
        face = faceKey(row.name),
        pkey = printingKey(row);
      // Slots in use, with their pocket count and whether they already hold this printing/face.
      const used = await tx.$queryRaw<{ slot: number; n: bigint; clash: boolean }[]>`
        SELECT slot, count(*) AS n, bool_or("lookKey" = ${look} OR "faceKey" = ${face}) AS clash
        FROM "SiteCopy" WHERE slot IS NOT NULL GROUP BY slot ORDER BY slot`;
      const bySlot = new Map(used.map((u) => [u.slot, { n: Number(u.n), clash: u.clash }]));
      const pocketsTaken = async (slot: number) =>
        new Set(
          (await tx.siteCopy.findMany({ where: { slot }, select: { pocket: true } })).map((c) => c.pocket),
        );
      const copies: Placed[] = [];
      let slot = SITE_FIRST_SLOT;
      for (let unit = 0; unit < row.quantity; unit++) {
        // A slot holds at most one copy of a printing (matches the production shelf's uniqueness).
        for (;;) {
          const s = bySlot.get(slot);
          if (!s || (!s.clash && s.n < POCKETS_PER_SLOT)) break;
          slot++;
        }
        const taken = await pocketsTaken(slot);
        let pocket = 1;
        while (taken.has(pocket)) pocket++;
        const copy = await tx.siteCopy.create({
          data: {
            receiptKey: `${row.eventKey}:${unit}`,
            printingKey: pkey,
            tcgplayerId: row.tcgplayerId,
            title: row.title,
            game: row.game,
            setName: row.setName,
            number: row.number,
            name: row.name,
            finish: row.finish,
            language: row.language,
            condition: row.condition,
            image: row.image,
            slot,
            pocket,
            lookKey: look,
            faceKey: face,
            status: "DRAFT", // Trevor Nov 24: new stock lands in Draft (hidden; feeds pack pools)
          },
          select: { id: true },
        });
        await tx.siteCopyEvent.create({
          data: { copyId: copy.id, toStatus: "DRAFT", actor: "card-broker", reason: `intake ${row.eventKey}` },
        });
        copies.push({ id: copy.id, slot, pocket });
        bySlot.set(slot, { n: (bySlot.get(slot)?.n ?? 0) + 1, clash: true });
      }
      const reply: Reply = { received: row.quantity, copies };
      await tx.siteIntakeReceipt.create({
        data: { eventKey: row.eventKey, digest: body, response: reply as unknown as Prisma.InputJsonValue },
      });
      return reply;
    },
    { timeout: 60000, maxWait: 15000 },
  );
}
