// Runs against a real Postgres (TEST_DATABASE_URL), because the draw relies on row locks.
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { commitmentHash } from "./fairness.server";
import {
  autoOpenDue,
  drawForOrder,
  launchSeries,
  pullsForViewer,
  revealPull,
  seriesOdds,
  voidPulls,
} from "./pool.server";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("Set TEST_DATABASE_URL to an empty Postgres database to run these tests.");

const db = new PrismaClient({ datasources: { db: { url } } });
const SHOP = "test-shop.myshopify.com";
const PACK = "gid://shopify/ProductVariant/1000";

beforeAll(() => {
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
});
afterAll(() => db.$disconnect());
beforeEach(async () => {
  await db.pull.deleteMany();
  await db.packOrder.deleteMany();
  await db.series.deleteMany();
});

async function makeSeries(cards: { name: string; tier: string; value: number; qty: number }[]) {
  return db.series.create({
    data: {
      shop: SHOP,
      title: "Series 1",
      handle: "series-1",
      packProductId: "gid://shopify/Product/1",
      packVariantId: PACK,
      packPrice: 10,
      cards: {
        create: cards.map((c, i) => ({
          variantId: `gid://shopify/ProductVariant/${2000 + i}`,
          productId: `gid://shopify/Product/${2000 + i}`,
          title: c.name,
          tier: c.tier,
          marketValue: c.value,
          quantity: c.qty,
        })),
      },
    },
  });
}

let orderSeq = 0;
function order(quantity: number, customer = "gid://shopify/Customer/1") {
  orderSeq++;
  return {
    shop: SHOP,
    orderId: `gid://shopify/Order/${orderSeq}`,
    orderName: `#${1000 + orderSeq}`,
    customerId: customer,
    lines: [{ lineItemId: `gid://shopify/LineItem/${orderSeq}`, variantId: PACK, quantity }],
  };
}

const standardPool = [
  { name: "Base", tier: "Base", value: 5, qty: 6 },
  { name: "Rare", tier: "Rare", value: 15, qty: 3 },
  { name: "Chase", tier: "Chase", value: 50, qty: 1 },
];

describe("launchSeries", () => {
  it("creates one slot per copy with a verifiable commitment", async () => {
    const series = await makeSeries(standardPool);
    const launched = await launchSeries(db, series.id);
    expect(launched.status).toBe("LIVE");

    const slots = await db.slot.findMany({
      where: { seriesId: series.id },
      orderBy: { position: "asc" },
      include: { card: true },
    });
    expect(slots).toHaveLength(10);
    expect(slots.map((s) => s.position)).toEqual([...Array(10).keys()]);
    expect(slots.filter((s) => s.card.title === "Chase")).toHaveLength(1);
    expect(
      commitmentHash(launched.salt!, slots.map((s) => s.card.variantId)),
    ).toBe(launched.commitHash);
  });

  it("refuses to relaunch a live series", async () => {
    const series = await makeSeries(standardPool);
    await launchSeries(db, series.id);
    await expect(launchSeries(db, series.id)).rejects.toThrow(/draft/);
  });
});

describe("drawForOrder", () => {
  it("claims positions in committed order and is idempotent", async () => {
    const series = await makeSeries(standardPool);
    await launchSeries(db, series.id);
    const input = order(3);

    const first = await drawForOrder(db, input);
    expect(first.pulls).toHaveLength(3);
    const again = await drawForOrder(db, input);
    expect(again.pulls).toHaveLength(0);

    const positions = (
      await db.pull.findMany({ include: { slot: true }, orderBy: { packIndex: "asc" } })
    ).map((p) => p.slot.position);
    expect(positions).toEqual([0, 1, 2]);
  });

  it("ignores line items that are not packs", async () => {
    const series = await makeSeries(standardPool);
    await launchSeries(db, series.id);
    const result = await drawForOrder(db, {
      ...order(1),
      lines: [{ lineItemId: "gid://shopify/LineItem/x", variantId: "gid://shopify/ProductVariant/9", quantity: 2 }],
    });
    expect(result.pulls).toHaveLength(0);
    expect(result.packOrder).toBeNull();
  });

  it("reports a shortfall and closes the series when it sells out", async () => {
    const series = await makeSeries(standardPool);
    await launchSeries(db, series.id);
    const result = await drawForOrder(db, order(12));
    expect(result.pulls).toHaveLength(10);
    expect(result.shortfall).toEqual([{ lineItemId: expect.any(String), missing: 2 }]);
    expect((await db.series.findUniqueOrThrow({ where: { id: series.id } })).status).toBe("CLOSED");
  });

  it("never gives the same card copy to two concurrent orders", async () => {
    const series = await makeSeries([{ name: "Base", tier: "Base", value: 5, qty: 40 }]);
    await launchSeries(db, series.id);
    const results = await Promise.all(Array.from({ length: 20 }, () => drawForOrder(db, order(3))));
    const slotIds = results.flatMap((r) => r.pulls.map((p) => p.slotId));
    expect(slotIds).toHaveLength(40);
    expect(new Set(slotIds).size).toBe(40);
    expect(results.reduce((n, r) => n + r.shortfall.reduce((m, s) => m + s.missing, 0), 0)).toBe(20);
  });

  it("matches the published odds over a full series", async () => {
    const series = await makeSeries(standardPool);
    await launchSeries(db, series.id);
    await drawForOrder(db, order(10));
    const counts = await db.pull.findMany({ include: { slot: { include: { card: true } } } });
    const byTitle = counts.reduce<Record<string, number>>((acc, p) => {
      acc[p.slot.card.title] = (acc[p.slot.card.title] ?? 0) + 1;
      return acc;
    }, {});
    expect(byTitle).toEqual({ Base: 6, Rare: 3, Chase: 1 });
  });
});

describe("revealPull", () => {
  it("only lets the buyer reveal, and reports when the order is ready", async () => {
    const series = await makeSeries(standardPool);
    await launchSeries(db, series.id);
    const { pulls, packOrder } = await drawForOrder(db, order(2));

    await expect(
      revealPull(db, SHOP, pulls[0].id, { customerId: "gid://shopify/Customer/999" }),
    ).rejects.toThrow(/not found/);

    const one = await revealPull(db, SHOP, pulls[0].id, { customerId: "gid://shopify/Customer/1" });
    expect(one.orderReady).toBe(false);
    const two = await revealPull(db, SHOP, pulls[1].id, { openToken: packOrder!.openToken });
    expect(two.orderReady).toBe(true);
    expect(two.card.title).toBeTruthy();
  });

  it("lists a guest's packs by order link token only", async () => {
    const series = await makeSeries(standardPool);
    await launchSeries(db, series.id);
    const a = await drawForOrder(db, order(1, "gid://shopify/Customer/1"));
    await drawForOrder(db, order(1, "gid://shopify/Customer/1"));
    const viaToken = await pullsForViewer(db, SHOP, { openToken: a.packOrder!.openToken });
    expect(viaToken).toHaveLength(1);
    const viaAccount = await pullsForViewer(db, SHOP, { customerId: "gid://shopify/Customer/1" });
    expect(viaAccount).toHaveLength(2);
  });
});

describe("autoOpenDue", () => {
  it("reveals packs older than the auto-open window", async () => {
    const series = await makeSeries(standardPool);
    await launchSeries(db, series.id);
    const { pulls } = await drawForOrder(db, order(2));
    expect(await autoOpenDue(db, new Date())).toEqual([]);

    const later = new Date(pulls[0].createdAt.getTime() + 7 * 86_400_000 + 1);
    const ready = await autoOpenDue(db, later);
    expect(ready).toHaveLength(1);
    expect(await db.pull.count({ where: { autoOpened: true } })).toBe(2);
  });
});

describe("voidPulls", () => {
  it("voids refunded packs without returning their cards to the sequence", async () => {
    const series = await makeSeries(standardPool);
    await launchSeries(db, series.id);
    const input = order(3);
    await drawForOrder(db, input);

    const voided = await voidPulls(db, input.orderId, new Map([[input.lines[0].lineItemId, 1]]));
    expect(voided).toHaveLength(1);
    expect(voided[0].packIndex).toBe(2);

    const odds = await seriesOdds(db, SHOP, "series-1");
    expect(odds!.packsRemaining).toBe(7);
    const next = await drawForOrder(db, order(1));
    expect((await db.slot.findUniqueOrThrow({ where: { id: next.pulls[0].slotId } })).position).toBe(3);
  });
});

describe("seriesOdds", () => {
  it("hides drafts and only publishes the sequence once closed", async () => {
    const series = await makeSeries(standardPool);
    expect(await seriesOdds(db, SHOP, "series-1")).toBeNull();
    await launchSeries(db, series.id);
    const live = await seriesOdds(db, SHOP, "series-1");
    expect(live!.reveal).toBeNull();
    expect(live!.cards.find((c) => c.title === "Chase")!.currentOdds).toBeCloseTo(0.1);

    await drawForOrder(db, order(10));
    const closed = await seriesOdds(db, SHOP, "series-1");
    expect(closed!.status).toBe("CLOSED");
    expect(commitmentHash(closed!.reveal!.salt!, closed!.reveal!.sequence)).toBe(closed!.commitHash);
  });
});
