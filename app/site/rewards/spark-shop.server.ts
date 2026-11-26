// Spark Shop on the standalone site (Trevor, Nov 26 2026): cardbit.com/sparks. Customers spend Sparks on real
// cards from the Spark Shop pool (SitePack "sparks-shop", kind "sparks"), which staff fill in Card Broker → Pools
// like any pool (Pool Rules, staged/published restocks, Fill Rules by value range, Auto-Fill From Drafts).
// Price = 5 Sparks per Cardbit of the card's current Cardbit price (≈500 Sparks per $1). A redeemed card goes to
// My Vault and works like any other vault card (keep, ship or sell back; Trevor chose sell-back allowed).
// Each redemption is one transaction under the pool lock and the Spark wallet row lock: one copy, one buyer,
// idempotent per requestId, and a price that changed since the customer looked is refused and shown again.
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { siteSparkPrice } from "../../lib/cardbit-sparks";
import { cardImage } from "../core/card-image";
import { tierFor, tierRules } from "../store/tiers";
import { copyValues } from "./spin-pools.server";
import { SITE_SHOP, siteSparksOn } from "./rewards.server";

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

export const SPARK_SHOP_POOL = "sparks-shop";

export class SparkShopError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409, readonly sparks: number | null = null) {
    super(message);
    this.name = "SparkShopError";
  }
}

/** Public key for one printing + condition in the shop (copy ids stay private). */
export const shopKey = (printingKey: string, condition: string) =>
  "k_" + createHash("sha256").update(`${printingKey}|${condition}`).digest("hex").slice(0, 20);

export type ShopCard = {
  key: string;
  title: string;
  name: string;
  set: string;
  number: string;
  finish: string;
  language: string;
  condition: string;
  image: string | null;
  tier: string | null;
  sparks: number;
  left: number;
};

/** Cards in the Spark Shop now, cheapest first. Unpriced copies aren't offered. */
export async function sparkShopCards(db: Db): Promise<ShopCard[]> {
  const pool = await db.sitePack.findUnique({ where: { id: SPARK_SHOP_POOL }, select: { kind: true, tierRules: true } });
  if (!pool || pool.kind !== "sparks") return [];
  const copies = await db.siteCopy.findMany({ where: { packId: SPARK_SHOP_POOL, status: "POOLED", ownerId: null, demo: false }, orderBy: { id: "asc" } });
  const values = await copyValues(db, copies);
  const rules = tierRules(pool.tierRules);
  const groups = new Map<string, ShopCard>();
  copies.forEach((c, i) => {
    const sparks = siteSparkPrice(values[i]);
    if (sparks == null) return;
    const key = shopKey(c.printingKey, c.condition);
    const g = groups.get(key);
    if (g) g.left++;
    else
      groups.set(key, {
        key,
        title: c.title,
        name: c.name,
        set: c.setName,
        number: c.number,
        finish: c.finish,
        language: c.language,
        condition: c.condition,
        image: cardImage(c),
        tier: tierFor(values[i], rules),
        sparks,
        left: 1,
      });
  });
  return [...groups.values()].sort((a, b) => a.sparks - b.sparks || a.title.localeCompare(b.title));
}

export async function sparkBalance(db: Db, customerId: string) {
  return (await db.cardbitSparkWallet.findUnique({ where: { shop_customerId: { shop: SITE_SHOP, customerId } }, select: { balance: true } }))?.balance ?? 0;
}

const REQ = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Redeem one copy of a shop card for Sparks. `expected` is the price the customer saw; a different current
 * price is refused with the new one. Retrying the same requestId returns the first result and charges once.
 */
export async function redeemSparkCard(db: PrismaClient, customerId: string, key: unknown, expected: unknown, requestId: unknown) {
  if (!siteSparksOn()) throw new SparkShopError("off", "The Spark Shop is not open yet.", 404);
  if (typeof key !== "string" || !/^k_[a-f0-9]{20}$/.test(key)) throw new SparkShopError("unknown", "Choose a card from the Spark Shop.", 400);
  if (typeof requestId !== "string" || !REQ.test(requestId)) throw new SparkShopError("bad_request", "Refresh the page and try again.", 400);
  const want = Number(expected);
  const eventKey = `spark-shop:site:${customerId}:${requestId}`;
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`site-pack:${SPARK_SHOP_POOL}`}, 0))::text`;
      await tx.$executeRaw`INSERT INTO "CardbitSparkWallet" (shop, "customerId") VALUES (${SITE_SHOP}, ${customerId}) ON CONFLICT (shop, "customerId") DO NOTHING`;
      await tx.$queryRaw`SELECT "customerId" FROM "CardbitSparkWallet" WHERE shop=${SITE_SHOP} AND "customerId"=${customerId} FOR UPDATE`;
      const done = await tx.cardbitSparkTxn.findUnique({ where: { shop_eventKey: { shop: SITE_SHOP, eventKey } } });
      if (done) {
        const copy = done.source ? await tx.siteCopy.findUnique({ where: { id: done.source } }) : null;
        return { replay: true, sparks: -done.delta, title: copy?.title ?? done.note ?? "Card", balance: await sparkBalance(tx, customerId) };
      }
      const pool = await tx.sitePack.findUnique({ where: { id: SPARK_SHOP_POOL } });
      if (!pool || pool.kind !== "sparks") throw new SparkShopError("off", "The Spark Shop is not open yet.", 404);
      const copies = await tx.siteCopy.findMany({ where: { packId: SPARK_SHOP_POOL, status: "POOLED", ownerId: null, demo: false }, orderBy: { id: "asc" } });
      const mine = copies.filter((c) => shopKey(c.printingKey, c.condition) === key);
      if (!mine.length) throw new SparkShopError("sold_out", "That card was just redeemed by someone else. Pick another one.", 409);
      const [value] = await copyValues(tx, [mine[0]]);
      const price = siteSparkPrice(value);
      if (price == null) throw new SparkShopError("sold_out", "That card isn't available right now. Pick another one.", 409);
      if (!Number.isSafeInteger(want) || want !== price)
        throw new SparkShopError("price_changed", `This card's price changed to ${price.toLocaleString("en-US")} Sparks. Check it and redeem again.`, 409, price);
      const balance = await sparkBalance(tx, customerId);
      if (balance < price) throw new SparkShopError("short", `You need ${(price - balance).toLocaleString("en-US")} more Sparks for this card.`, 409, price);
      const copy = mine[0];
      const n = await tx.siteCopy.updateMany({
        where: { id: copy.id, status: "POOLED", packId: SPARK_SHOP_POOL, ownerId: null },
        data: { status: "VAULTED", ownerId: customerId, packId: null, restockId: null, orderId: `sparks:${requestId}`.slice(0, 190), pulledTier: tierFor(value, tierRules(pool.tierRules)) ?? null, acquiredVia: "sparks" },
      });
      if (!n.count) throw new SparkShopError("sold_out", "That card was just redeemed by someone else. Pick another one.", 409);
      await tx.cardbitSparkTxn.create({ data: { shop: SITE_SHOP, customerId, eventKey, kind: "shop", delta: -price, source: copy.id, note: copy.title.slice(0, 190) } });
      await tx.cardbitSparkWallet.update({ where: { shop_customerId: { shop: SITE_SHOP, customerId } }, data: { balance: { decrement: price } } });
      await tx.siteCopyEvent.create({ data: { copyId: copy.id, fromStatus: "POOLED", toStatus: "VAULTED", actor: `customer:${customerId}`, reason: `spark shop ${price} Sparks` } });
      return { replay: false, sparks: price, title: copy.title, balance: balance - price };
    },
    { timeout: 20_000 },
  );
}

