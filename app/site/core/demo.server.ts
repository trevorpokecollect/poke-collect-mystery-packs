// Demo data for the standalone site (staff Demo panel on /staff/stock). Trevor asked, Nov 24 2026:
// load a test account with Cardbits, sealed packs and vault cards from real Card Broker intake,
// all marked demo so one Wipe Demo removes it before launch. Customers never see the flag.
// Demo packs and vault cards only ever use copies marked demo, so real stock is never given away.
import { randomInt } from "node:crypto";
import type { Prisma, PrismaClient, SiteCopy } from "@prisma/client";
import { normalizeEmail, upsertCustomer } from "./auth.server";
import { applyLedger, balanceOf, postLedger } from "./ledger.server";
import { priceKey } from "./stock.server";
import { reverseOpeningRewards } from "../rewards/rewards.server";

type Tx = Prisma.TransactionClient;
export class DemoError extends Error {}

const DEMO_REF = "demo";
const WIPE_REF = "demo-wipe";
const UUID = /^[a-f0-9-]{36}$/i;

async function lockKey(tx: Tx, key: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
}

async function customerFor(db: PrismaClient, email: string) {
  const e = normalizeEmail(email || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new DemoError("Enter the customer's email.");
  return upsertCustomer(db, { email: e, method: "demo" });
}

/** Mark (or unmark) copies as demo stock. */
export async function markDemo(db: PrismaClient, actor: string, copyIds: string[], demo: boolean) {
  const ids = [...new Set(copyIds.filter((x) => typeof x === "string" && x.length <= 60))].slice(0, 500);
  if (!ids.length) throw new DemoError("Select cards first.");
  return db.$transaction(async (tx) => {
    const rows = await tx.siteCopy.findMany({ where: { id: { in: ids }, demo: !demo }, select: { id: true, status: true } });
    for (const r of rows) {
      await tx.siteCopy.update({ where: { id: r.id }, data: { demo } });
      await tx.siteCopyEvent.create({ data: { copyId: r.id, fromStatus: r.status, toStatus: r.status, actor, reason: demo ? "marked demo" : "demo mark removed" } });
    }
    return { changed: rows.length };
  });
}

/** Free Cardbits for a test account (ledger ADJUST, ref "demo"). requestId makes a double submit a no-op. */
export async function grantDemoCardbits(db: PrismaClient, actor: string, email: string, amount: unknown, requestId: string) {
  const bits = Number(String(amount ?? "").replace(/[, ]/g, ""));
  if (!Number.isSafeInteger(bits) || bits <= 0 || bits > 1_000_000) throw new DemoError("Enter whole Cardbits, up to 1,000,000.");
  if (!UUID.test(requestId || "")) throw new DemoError("Reload the page and try again.");
  const customer = await customerFor(db, email);
  const { entry, replay } = await postLedger(db, {
    customerId: customer.id,
    delta: bits,
    kind: "ADJUST",
    ref: DEMO_REF,
    idempotencyKey: `demo-credit:${requestId}`,
    note: "Cardbits Added",
  });
  void actor;
  return { email: customer.email, bits, balance: entry.balanceAfter, replay };
}

/** Sealed packs in a customer's account, drawn now from the pack's demo pool at no charge. */
export async function giveDemoPacks(db: PrismaClient, actor: string, email: string, packId: string, count: unknown, rand: (n: number) => number = randomInt) {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > 20) throw new DemoError("Give 1 to 20 packs at a time.");
  const customer = await customerFor(db, email);
  return db.$transaction(
    async (tx) => {
      const pack = await tx.sitePack.findUnique({ where: { id: packId || "" } });
      if (!pack) throw new DemoError("Choose a pack.");
      await lockKey(tx, `site-pack:${pack.id}`);
      const pool = await tx.siteCopy.findMany({ where: { packId: pack.id, status: "POOLED", demo: true, ownerId: null }, orderBy: { id: "asc" } });
      if (pool.length < pack.cardsPerPack * n)
        throw new DemoError(`${pack.title} has ${pool.length} demo card${pool.length === 1 ? "" : "s"} in its pool; ${pack.cardsPerPack * n} needed.`);
      const keys = [...new Set(pool.map((c) => priceKey(c.printingKey, c.condition)))];
      const prices = new Map((await tx.sitePrice.findMany({ where: { printingKey: { in: keys } } })).map((p) => [p.printingKey, p.retailBits ?? 0]));
      const value = (c: SiteCopy) => c.retailBits ?? prices.get(priceKey(c.printingKey, c.condition)) ?? 0;
      const left = pool.slice();
      const openings: string[] = [];
      for (let k = 0; k < n; k++) {
        const opening = await tx.siteOpening.create({ data: { customerId: customer.id, packId: pack.id, priceBits: 0, sealed: true, demo: true } });
        const drawn: SiteCopy[] = [];
        for (let i = 0; i < pack.cardsPerPack; i++) drawn.push(left.splice(rand(left.length), 1)[0]);
        drawn.sort((x, y) => value(x) - value(y));
        for (const [i, c] of drawn.entries()) {
          const moved = await tx.siteCopy.updateMany({
            where: { id: c.id, status: "POOLED", packId: pack.id },
            data: { status: "VAULTED", ownerId: customer.id, packId: null, restockId: null, openingId: opening.id, position: i + 1, orderId: opening.id },
          });
          if (moved.count !== 1) throw new DemoError("The pool changed. Try again.");
          await tx.siteCopyEvent.create({ data: { copyId: c.id, fromStatus: "POOLED", toStatus: "VAULTED", actor, reason: `demo pack ${opening.id}` } });
        }
        openings.push(opening.id);
      }
      return { email: customer.email, pack: pack.title, openings };
    },
    { timeout: 20_000 },
  );
}

/** Random demo singles from the shop straight into a customer's vault, at no charge. */
export async function giveDemoVaultCards(db: PrismaClient, actor: string, email: string, count: unknown, rand: (n: number) => number = randomInt) {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > 50) throw new DemoError("Give 1 to 50 cards at a time.");
  const customer = await customerFor(db, email);
  return db.$transaction(async (tx) => {
    const shop = await tx.siteCopy.findMany({ where: { status: { in: ["FOR_SALE", "DRAFT"] }, demo: true, ownerId: null, restockId: null }, orderBy: { id: "asc" } });
    if (shop.length < n) throw new DemoError(`Only ${shop.length} demo card${shop.length === 1 ? " is" : "s are"} in the shop.`);
    const moved: string[] = [];
    for (let i = 0; i < n; i++) {
      const c = shop.splice(rand(shop.length), 1)[0];
      const r = await tx.siteCopy.updateMany({ where: { id: c.id, status: c.status, ownerId: null }, data: { status: "VAULTED", ownerId: customer.id, orderId: "demo" } });
      if (r.count !== 1) throw new DemoError("The shop changed. Try again.");
      await tx.siteCopyEvent.create({ data: { copyId: c.id, fromStatus: c.status, toStatus: "VAULTED", actor, reason: "demo vault card" } });
      moved.push(c.id);
    }
    return { email: customer.email, copies: moved };
  });
}

export async function demoSummary(db: PrismaClient) {
  const [copies, byStatus, openings, credits] = await Promise.all([
    db.siteCopy.count({ where: { demo: true } }),
    db.siteCopy.groupBy({ by: ["status"], where: { demo: true }, _count: { _all: true } }),
    db.siteOpening.count({ where: { demo: true } }),
    db.siteLedger.aggregate({ where: { kind: "ADJUST", ref: DEMO_REF }, _sum: { delta: true } }),
  ]);
  return {
    copies,
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) as Record<string, number>,
    openings,
    creditedBits: credits._sum.delta ?? 0,
  };
}

/**
 * Remove all demo data: demo copies (and their events, shipment lines and orphaned prices), openings
 * that held only demo cards, and the Cardbits that came from demo credits or demo buybacks. Cardbits
 * are taken back with a reversing ADJUST entry (ref "demo-wipe"), capped at the balance; ledger history
 * is never deleted.
 */
export async function wipeDemo(db: PrismaClient, actor: string) {
  return db.$transaction(
    async (tx) => {
      await lockKey(tx, "site-demo-wipe");
      const copies = await tx.siteCopy.findMany({ where: { demo: true }, select: { id: true, printingKey: true, condition: true, openingId: true, packId: true } });
      const copyIds = copies.map((c) => c.id);
      for (const packId of new Set(copies.map((c) => c.packId).filter(Boolean) as string[])) await lockKey(tx, `site-pack:${packId}`);

      // Openings: demo-given ones, plus bought ones whose cards were all demo.
      const touched = [...new Set(copies.map((c) => c.openingId).filter(Boolean) as string[])];
      const mixed = touched.length
        ? new Set((await tx.siteCopy.findMany({ where: { openingId: { in: touched }, demo: false }, select: { openingId: true } })).map((c) => c.openingId))
        : new Set<string | null>();
      const openingIds = [
        ...new Set([...(await tx.siteOpening.findMany({ where: { demo: true }, select: { id: true } })).map((o) => o.id), ...touched.filter((id) => !mixed.has(id))]),
      ];

      // Shipments: drop demo lines; a shipment left with no lines is deleted.
      let shipmentsDeleted = 0;
      if (copyIds.length) {
        const lines = await tx.siteShipmentItem.findMany({ where: { copyId: { in: copyIds } }, select: { shipmentId: true } });
        await tx.siteShipmentItem.deleteMany({ where: { copyId: { in: copyIds } } });
        for (const shipmentId of new Set(lines.map((l) => l.shipmentId))) {
          if ((await tx.siteShipmentItem.count({ where: { shipmentId } })) === 0) {
            await tx.siteShipment.delete({ where: { id: shipmentId } });
            shipmentsDeleted++;
          }
        }
      }

      // Cardbits: demo credits + buybacks of demo copies, less earlier wipes, capped at the balance.
      const sources = await tx.siteLedger.findMany({
        where: { OR: [{ kind: "ADJUST", ref: { in: [DEMO_REF, WIPE_REF] } }, ...(copyIds.length ? [{ kind: "BUYBACK", ref: { in: copyIds } }] : [])] },
        select: { customerId: true, delta: true },
      });
      const owed = new Map<string, number>();
      for (const s of sources) owed.set(s.customerId, (owed.get(s.customerId) ?? 0) + s.delta);
      const stamp = Date.now().toString(36);
      let bitsRemoved = 0;
      for (const [customerId, amount] of owed) {
        await lockKey(tx, `site-customer:${customerId}`);
        const take = Math.min(amount, await balanceOf(tx, customerId));
        if (take <= 0) continue;
        await applyLedger(tx, { customerId, delta: -take, kind: "ADJUST", ref: WIPE_REF, idempotencyKey: `demo-wipe:${customerId}:${stamp}`, note: "Demo Cardbits removed" });
        bitsRemoved += take;
      }

      if (copyIds.length) {
        await tx.siteCopyEvent.deleteMany({ where: { copyId: { in: copyIds } } });
        await tx.siteCopy.deleteMany({ where: { id: { in: copyIds } } });
      }
      if (openingIds.length) {
        await reverseOpeningRewards(tx, openingIds, "demo wipe");
        await tx.siteOpening.deleteMany({ where: { id: { in: openingIds } } });
      }
      // Prices are keyed by printing + condition; drop only the ones no remaining copy uses.
      const keys = [...new Set(copies.map((c) => priceKey(c.printingKey, c.condition)))];
      const printings = [...new Set(copies.map((c) => c.printingKey))];
      const stillUsed = new Set(
        printings.length
          ? (await tx.siteCopy.findMany({ where: { printingKey: { in: printings } }, select: { printingKey: true, condition: true } })).map((c) => priceKey(c.printingKey, c.condition))
          : [],
      );
      const orphanKeys = keys.filter((k) => !stillUsed.has(k));
      if (orphanKeys.length) await tx.sitePrice.deleteMany({ where: { printingKey: { in: orphanKeys } } });
      void actor;
      return { copies: copyIds.length, openings: openingIds.length, shipments: shipmentsDeleted, prices: orphanKeys.length, bitsRemoved };
    },
    { timeout: 60_000 },
  );
}
