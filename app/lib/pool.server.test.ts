// Runs against a real Postgres (TEST_DATABASE_URL), because the draw relies on row locks.
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { commitmentHash } from "./fairness.server";
import {
  autoOpenDue,
  claimGuestOrder,
  drawForOrder,
  launchSeries,
  pullsForViewer,
  revealPull,
  seriesOdds,
  voidPulls,
} from "./pool.server";
import { releaseUnneeded, rereserveForPulls, reservePool, unreserveForPulls } from "./inventory.server";
import { checkTopTierGone } from "./top-tier-alert.server";
import { addVaultCardsToShipment, moveVault, resolveCustomer, returnShipmentToVault, expireShipments, markShipmentPaid, requestShipment, vaultedPulls } from "./vault.server";

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
  await db.shipRequest.deleteMany();
  await db.packOrder.deleteMany();
  await db.series.deleteMany();
});

async function makeSeries(
  cards: { name: string; tier: string; value: number; qty: number }[],
  handle = "series-1",
  cardsPerPack = 1,
) {
  return db.series.create({
    data: {
      shop: SHOP,
      cardsPerPack,
      title: handle,
      handle,
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
function order(quantity: number, customer: string | null = "gid://shopify/Customer/1") {
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

describe("reusing a pack product", () => {
  it("draws from the live series once an earlier one on the same pack has closed", async () => {
    const first = await makeSeries(standardPool, "series-1");
    await launchSeries(db, first.id);
    const early = order(1);
    await drawForOrder(db, early);
    await db.series.update({ where: { id: first.id }, data: { status: "CLOSED" } });

    const second = await makeSeries(standardPool, "series-2");
    await launchSeries(db, second.id);
    const later = order(2);
    const result = await drawForOrder(db, later);
    expect(result.pulls).toHaveLength(2);
    expect(result.pulls.every((p) => p.seriesId === second.id)).toBe(true);

    // A retried webhook for the early order stays with the series that drew it.
    const retry = await drawForOrder(db, early);
    expect(retry.pulls).toHaveLength(0);
    expect(await db.pull.count({ where: { orderId: early.orderId, seriesId: first.id } })).toBe(1);
  });
});

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

  it("draws once when orders/create and orders/paid arrive together", async () => {
    const series = await makeSeries(standardPool);
    await launchSeries(db, series.id);
    const input = order(2);

    const results = await Promise.all([drawForOrder(db, input), drawForOrder(db, input)]);
    expect(results.flatMap((r) => r.pulls)).toHaveLength(2);
    expect(await db.pull.count({ where: { orderId: input.orderId } })).toBe(2);
    expect(await db.slot.count({ where: { seriesId: series.id, claimed: true } })).toBe(2);
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

  it("shows a logged-in customer their whole history when they follow an order link", async () => {
    const series = await makeSeries(standardPool);
    await launchSeries(db, series.id);
    await drawForOrder(db, order(1, "gid://shopify/Customer/1"));
    // An order placed as a guest, opened through its link while logged in.
    const guest = await drawForOrder(db, order(1, null));
    const both = await pullsForViewer(db, SHOP, {
      customerId: "gid://shopify/Customer/1",
      openToken: guest.packOrder!.openToken,
    });
    expect(both).toHaveLength(2);
    // Following the link while logged in claimed the guest order, so the account alone can open it now.
    const opened = await revealPull(db, SHOP, guest.pulls[0].id, { customerId: "gid://shopify/Customer/1" });
    expect(opened.card.title).toBeTruthy();
    // Someone else's account can't.
    await expect(
      revealPull(db, SHOP, guest.pulls[0].id, { customerId: "gid://shopify/Customer/2" }),
    ).rejects.toThrow(/not found/);
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

// Records inventory moves instead of calling Shopify. Like Shopify, a move whose idempotency
// key was already used is accepted but does nothing.
function fakeAdmin() {
  const moves: { from: string; to: string; quantity: number; item: string; key: string }[] = [];
  const seenKeys = new Set<string>();
  const admin = {
    graphql: async (_query: string, { variables }: { variables: Record<string, unknown> }) => {
      const input = variables.input as {
        changes: { quantity: number; inventoryItemId: string; from: { name: string }; to: { name: string } }[];
      } | undefined;
      // Anything that isn't an inventory move (e.g. the return guard's stock lookup) gets an empty answer.
      if (!input?.changes) return new Response(JSON.stringify({ data: {} }));
      const key = String(variables.key);
      if (seenKeys.has(key)) return new Response(JSON.stringify({ data: { inventoryMoveQuantities: { userErrors: [] } } }));
      seenKeys.add(key);
      for (const c of input.changes) {
        moves.push({ from: c.from.name, to: c.to.name, quantity: c.quantity, item: c.inventoryItemId, key: String(variables.key) });
      }
      return new Response(JSON.stringify({ data: { inventoryMoveQuantities: { userErrors: [] } } }));
    },
  };
  const net = (item: string) =>
    moves.filter((m) => m.item === item).reduce((n, m) => n + (m.to === "reserved" ? m.quantity : -m.quantity), 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: admin as any, moves, net };
}

async function makeReservedSeries(n: number) {
  const series = await makeSeries(
    Array.from({ length: n }, (_, i) => ({ name: `Card ${i}`, tier: "Poke", value: 5, qty: 1 })),
  );
  await db.series.update({ where: { id: series.id }, data: { reserveInventory: true } });
  const cards = await db.card.findMany({ where: { seriesId: series.id } });
  for (const c of cards) {
    await db.card.update({
      where: { id: c.id },
      data: { inventoryItemId: `item-${c.title}`, locationId: "gid://shopify/Location/1" },
    });
  }
  return series;
}

describe("inventory reservation", () => {
  it("reserves every card at launch and releases unpulled ones when the series closes", async () => {
    const { admin, net } = fakeAdmin();
    const series = await makeReservedSeries(5);
    await reservePool(db, admin, series.id);
    await launchSeries(db, series.id);
    expect((await db.card.findMany({ where: { seriesId: series.id } })).every((c) => c.reservedQty === 1)).toBe(true);

    // Nothing is released while the series is live.
    expect(await releaseUnneeded(db, admin, series.id)).toBe(0);

    // Two packs sold, one still unopened, then the merchant closes the series early.
    const { pulls } = await drawForOrder(db, order(2));
    await db.series.update({ where: { id: series.id }, data: { status: "CLOSED" } });
    expect(await releaseUnneeded(db, admin, series.id)).toBe(3);

    const held = await db.pull.findMany({ where: { id: { in: pulls.map((p) => p.id) } }, include: { slot: { include: { card: true } } } });
    for (const p of held) expect(net(p.slot.card.inventoryItemId!)).toBe(1);
    const total = (await db.card.findMany({ where: { seriesId: series.id } })).reduce((n, c) => n + c.reservedQty, 0);
    expect(total).toBe(2);
  });

  it("frees a won copy once for the order edit, even when retried", async () => {
    const { admin, moves } = fakeAdmin();
    const series = await makeReservedSeries(3);
    await reservePool(db, admin, series.id);
    await launchSeries(db, series.id);
    const { pulls } = await drawForOrder(db, order(1));

    await unreserveForPulls(db, admin, [pulls[0].id]);
    await unreserveForPulls(db, admin, [pulls[0].id]);
    expect(moves.filter((m) => m.from === "reserved")).toHaveLength(1);

    // After the card ships, closing the series releases only the two unpulled cards.
    await db.series.update({ where: { id: series.id }, data: { status: "CLOSED" } });
    expect(await releaseUnneeded(db, admin, series.id)).toBe(2);
  });

  it("puts a refunded pack's card straight back on sale", async () => {
    const { admin } = fakeAdmin();
    const series = await makeReservedSeries(3);
    await reservePool(db, admin, series.id);
    await launchSeries(db, series.id);
    const input = order(1);
    await drawForOrder(db, input);
    await voidPulls(db, input.orderId);
    expect(await releaseUnneeded(db, admin, series.id)).toBe(1);
  });

  it("leaves hand-picked series alone", async () => {
    const { admin, moves } = fakeAdmin();
    const series = await makeSeries(standardPool);
    await reservePool(db, admin, series.id);
    await launchSeries(db, series.id);
    await db.series.update({ where: { id: series.id }, data: { status: "CLOSED" } });
    expect(await releaseUnneeded(db, admin, series.id)).toBe(0);
    expect(moves).toHaveLength(0);
  });
});

describe("checkTopTierGone", () => {
  it("fires the Flow trigger once, right after the last top-tier card is pulled", async () => {
    const series = await makeSeries(standardPool);
    await db.series.update({
      where: { id: series.id },
      data: { tierRules: [{ name: "Base", min: 0 }, { name: "Rare", min: 10 }, { name: "Chase", min: 40 }] },
    });
    await launchSeries(db, series.id);
    const calls: unknown[] = [];
    const admin = {
      graphql: async (_q: string, opts: { variables: unknown }) => {
        calls.push(opts.variables);
        return { json: async () => ({ data: { flowTriggerReceive: { userErrors: [] } } }) };
      },
    } as unknown as Parameters<typeof checkTopTierGone>[1];

    let chaseGone = false;
    for (let i = 0; i < 10 && !chaseGone; i++) {
      const { pulls } = await drawForOrder(db, order(1));
      await checkTopTierGone(db, admin, SHOP, pulls.map((p) => p.seriesId));
      const left = await db.slot.count({ where: { seriesId: series.id, claimed: false, card: { tier: "Chase" } } });
      chaseGone = left === 0;
      expect(calls).toHaveLength(chaseGone ? 1 : 0);
    }
    expect(chaseGone).toBe(true);
    await checkTopTierGone(db, admin, SHOP, [series.id]);
    expect(calls).toHaveLength(1);
    expect((calls[0] as { payload: Record<string, unknown> }).payload).toMatchObject({ Tier: "Chase" });
  });
});

describe("multi-card packs", () => {
  const boosterPool = [
    { name: "Cheap", tier: "Poke", value: 1, qty: 12 },
    { name: "Mid", tier: "Great", value: 5, qty: 2 },
    { name: "Hit", tier: "Ultra", value: 40, qty: 1 },
  ];

  it("draws a full pack of cards per pack, in committed order", async () => {
    const series = await makeSeries(boosterPool, "booster", 5);
    await launchSeries(db, series.id);
    const { pulls, shortfall } = await drawForOrder(db, order(2));
    expect(shortfall).toEqual([]);
    expect(pulls).toHaveLength(10);
    const rows = await db.pull.findMany({ include: { slot: true }, orderBy: [{ packIndex: "asc" }, { cardIndex: "asc" }] });
    expect(rows.map((p) => [p.packIndex, p.cardIndex])).toEqual([
      [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 0], [1, 1], [1, 2], [1, 3], [1, 4],
    ]);
    expect(rows.map((p) => p.slot.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const odds = await seriesOdds(db, SHOP, "booster");
    expect(odds!.cardsPerPack).toBe(5);
    expect(odds!.totalPacks).toBe(3);
    expect(odds!.packsRemaining).toBe(1);
  });

  it("closes once a full pack can no longer be made", async () => {
    const series = await makeSeries(boosterPool, "booster", 5);
    await launchSeries(db, series.id);
    const { shortfall } = await drawForOrder(db, order(4));
    expect(shortfall.map((s) => s.missing)).toEqual([1]);
    expect((await db.series.findUniqueOrThrow({ where: { id: series.id } })).status).toBe("CLOSED");
    expect(await db.pull.count()).toBe(15);
  });

  it("reveals the whole pack at once, cheapest card first", async () => {
    const series = await makeSeries(boosterPool, "booster", 5);
    await launchSeries(db, series.id);
    const { pulls } = await drawForOrder(db, order(1));
    const opened = await revealPull(db, SHOP, pulls[2].id, { customerId: "gid://shopify/Customer/1" });
    expect(opened.cards).toHaveLength(5);
    const values = opened.cards.map((c) => Number(c.marketValue));
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(opened.card).toBe(opened.cards[4]);
    expect(opened.orderReady).toBe(true);
    expect(await db.pull.count({ where: { status: "REVEALED" } })).toBe(5);
  });

  it("voids every card of a refunded pack", async () => {
    const series = await makeSeries(boosterPool, "booster", 5);
    await launchSeries(db, series.id);
    const input = order(2);
    await drawForOrder(db, input);
    const voided = await voidPulls(db, input.orderId, new Map([[input.lines[0].lineItemId, 1]]));
    expect(voided).toHaveLength(5);
    expect(new Set(voided.map((p) => p.packIndex))).toEqual(new Set([1]));
  });
});

// Handles the Shopify calls a vault shipment makes, recording the draft orders it creates.
function vaultAdmin() {
  const base = fakeAdmin();
  const drafts: { input: Record<string, unknown> }[] = [];
  const deleted: string[] = [];
  const edits: { added: { variantId: string; quantity: number }[]; discounted: number; committed: boolean; cancelled?: boolean } = { added: [], discounted: 0, committed: false };
  const admin = {
    graphql: async (query: string, opts: { variables: Record<string, unknown> }) => {
      // A query written on the "#graphql" comment line is all comment; Shopify rejects it.
      const body = query.split("\n").map((l) => l.replace(/#.*$/, "")).join("").trim();
      if (!body) throw new Error("Empty GraphQL query (everything is on the #graphql comment line)");
      const reply = (data: unknown) => new Response(JSON.stringify({ data }));
      if (query.includes("draftOrderCreate")) {
        drafts.push({ input: opts.variables.input as Record<string, unknown> });
        return reply({ draftOrderCreate: { draftOrder: { id: `gid://shopify/DraftOrder/${drafts.length}`, invoiceUrl: `https://pay/${drafts.length}` }, userErrors: [] } });
      }
      if (query.includes("tagsAdd")) return reply({ tagsAdd: { node: { id: "x" }, userErrors: [] } });
      if (query.includes("VaultOrderCountry")) return reply({ order: { shippingAddress: null, billingAddress: { countryCodeV2: "US" } } });
      if (query.includes("VaultCurrency")) return reply({ shop: { currencyCode: "USD" } });
      if (query.includes("VaultOrderEmail")) return reply({ order: { email: "guest@example.com" } });
      if (query.includes("VaultDraftStatus")) return reply({ draftOrder: { id: "d", status: "OPEN", order: null } });
      if (query.includes("draftOrderComplete")) {
        return reply({ draftOrderComplete: { draftOrder: { order: { id: "gid://shopify/Order/777", name: "#777" } }, userErrors: [] } });
      }
      if (query.includes("VaultReturnOrder(")) return reply({ order: { name: "#999", cancelledAt: edits.cancelled ? "now" : null, displayFulfillmentStatus: "UNFULFILLED" } });
      if (query.includes("orderCancel(")) {
        edits.cancelled = query.includes("originalPaymentMethodsRefund: true");
        return reply({ orderCancel: { orderCancelUserErrors: [] } });
      }
      if (query.includes("VaultReturnCancelled(")) return reply({ order: { cancelledAt: edits.cancelled ? "now" : null } });
      if (query.includes("orderEditBegin")) return reply({ orderEditBegin: { calculatedOrder: { id: "calc-1" }, userErrors: [] } });
      if (query.includes("orderEditAddVariant")) {
        edits.added.push({ variantId: String(opts.variables.variantId), quantity: Number(opts.variables.quantity) });
        return reply({ orderEditAddVariant: { calculatedLineItem: { id: `cli-${edits.added.length}` }, userErrors: [] } });
      }
      if (query.includes("orderEditAddLineItemDiscount")) {
        edits.discounted++;
        return reply({ orderEditAddLineItemDiscount: { userErrors: [] } });
      }
      if (query.includes("orderEditCommit")) {
        edits.committed = true;
        return reply({ orderEditCommit: { order: { id: "o" }, userErrors: [] } });
      }
      if (query.includes("draftOrderDelete")) {
        deleted.push(String((opts.variables.input as { id: string }).id));
        return reply({ draftOrderDelete: { deletedId: "d", userErrors: [] } });
      }
      return base.admin.graphql(query, opts);
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: admin as any, drafts, deleted, edits, net: base.net };
}

describe("vault", () => {
  const viewer = { customerId: "gid://shopify/Customer/1" };

  async function openedVaultOrder(packs: number) {
    const series = await makeReservedSeries(10);
    const { admin } = vaultAdmin();
    await reservePool(db, admin, series.id);
    await launchSeries(db, series.id);
    const { pulls, packOrder } = await drawForOrder(db, order(packs));
    expect(packOrder!.vault).toBe(true);
    for (const p of pulls) await revealPull(db, SHOP, p.id, viewer);
    return pulls;
  }

  it("ships every vaulted card on one invoice with the flat fee, then marks them shipping once paid", async () => {
    const pulls = await openedVaultOrder(3);
    expect(await vaultedPulls(db, SHOP, viewer)).toHaveLength(3);

    const { admin, drafts, net } = vaultAdmin();
    const first = await requestShipment(db, admin, SHOP, viewer);
    expect(first.invoiceUrl).toBe("https://pay/1");
    expect(drafts).toHaveLength(1);
    const input = drafts[0].input as { shippingLine: { priceWithCurrency: { amount: string } }; lineItems: unknown[]; customAttributes: { value: string }[] };
    expect(input.shippingLine.priceWithCurrency.amount).toBe("5.00");
    expect(input.lineItems).toHaveLength(3);
    // Each card's reserved copy is released for the draft order's own reservation.
    expect(pulls.map((p) => p.slotId)).toHaveLength(3);
    expect((await db.pull.findMany()).every((p) => p.unreservedAt)).toBe(true);
    const released = Array.from({ length: 10 }, (_, i) => net(`item-Card ${i}`)).reduce((a, b) => a + b, 0);
    expect(released).toBe(-3);

    // Asking again returns the same open invoice instead of a second one.
    const again = await requestShipment(db, admin, SHOP, viewer);
    expect(again).toEqual({ invoiceUrl: "https://pay/1", reused: true });
    expect(drafts).toHaveLength(1);

    const requestId = input.customAttributes[0].value;
    await markShipmentPaid(db, requestId, "gid://shopify/Order/999");
    const shipped = await db.pull.findMany();
    expect(shipped.every((p) => p.status === "FULFILLING" && p.shipOrderId === "gid://shopify/Order/999")).toBe(true);
    await expect(requestShipment(db, admin, SHOP, viewer)).rejects.toThrow(/no cards in your vault/);
  });

  it("replaces an open invoice with one for every card when more cards are opened", async () => {
    const series = await makeReservedSeries(10);
    const { admin, drafts, deleted } = vaultAdmin();
    await reservePool(db, admin, series.id);
    await launchSeries(db, series.id);
    const first = await drawForOrder(db, order(1));
    await revealPull(db, SHOP, first.pulls[0].id, viewer);
    await requestShipment(db, admin, SHOP, viewer);
    expect((drafts[0].input as { lineItems: unknown[] }).lineItems).toHaveLength(1);

    const second = await drawForOrder(db, order(2));
    for (const p of second.pulls) await revealPull(db, SHOP, p.id, viewer);
    const again = await requestShipment(db, admin, SHOP, viewer);
    expect(again).toEqual({ invoiceUrl: "https://pay/2", reused: false });
    expect(deleted).toEqual(["gid://shopify/DraftOrder/1"]);
    const lines = (drafts[1].input as { lineItems: { quantity: number }[] }).lineItems;
    expect(lines.reduce((n, l) => n + l.quantity, 0)).toBe(3);
    const requests = await db.shipRequest.findMany({ orderBy: { createdAt: "asc" } });
    expect(requests.map((r) => r.status)).toEqual(["CANCELLED", "PENDING"]);
    expect(await db.pull.count({ where: { shipRequestId: requests[1].id, unreservedAt: { not: null } } })).toBe(3);
  });

  it("adds cards opened after payment to the paid, unshipped vault order at no charge", async () => {
    const series = await makeReservedSeries(10);
    const { admin, drafts, edits, deleted } = vaultAdmin();
    await reservePool(db, admin, series.id);
    await launchSeries(db, series.id);
    const first = await drawForOrder(db, order(1));
    await revealPull(db, SHOP, first.pulls[0].id, viewer);
    await requestShipment(db, admin, SHOP, viewer);
    const requestId = (drafts[0].input as { customAttributes: { value: string }[] }).customAttributes[0].value;
    await markShipmentPaid(db, requestId, "gid://shopify/Order/999");

    const second = await drawForOrder(db, order(2));
    for (const p of second.pulls) await revealPull(db, SHOP, p.id, viewer);
    // The customer already asked to ship these on a second invoice; it's cancelled, not charged.
    await requestShipment(db, admin, SHOP, viewer);
    expect(await addVaultCardsToShipment(db, admin, SHOP, requestId)).toBe(2);
    expect(deleted).toEqual(["gid://shopify/DraftOrder/2"]);
    expect(edits.added.reduce((n, a) => n + a.quantity, 0)).toBe(2);
    expect(edits.discounted).toBe(edits.added.length);
    expect(edits.committed).toBe(true);
    const pulls = await db.pull.findMany();
    expect(pulls.every((p) => p.status === "FULFILLING" && p.shipOrderId === "gid://shopify/Order/999" && p.shipRequestId === requestId)).toBe(true);
    expect(pulls.every((p) => p.unreservedAt)).toBe(true);
    expect((await db.shipRequest.findUniqueOrThrow({ where: { id: requestId } })).cardCount).toBe(3);
    expect(await addVaultCardsToShipment(db, admin, SHOP, requestId)).toBe(0);
  });

  it("sets every vault card aside on a free local pickup order, replacing an open invoice", async () => {
    const series = await makeReservedSeries(10);
    const { admin, drafts, deleted } = vaultAdmin();
    await reservePool(db, admin, series.id);
    await launchSeries(db, series.id);
    const { pulls } = await drawForOrder(db, order(3));
    for (const p of pulls) await revealPull(db, SHOP, p.id, viewer);
    await requestShipment(db, admin, SHOP, viewer);

    const result = await requestShipment(db, admin, SHOP, viewer, { pickup: true });
    expect(result).toEqual({ invoiceUrl: null, reused: false, pickupOrder: "#777" });
    expect(deleted).toEqual(["gid://shopify/DraftOrder/1"]);
    const input = drafts[1].input as { tags: string[]; shippingLine: { title: string; priceWithCurrency: { amount: string } }; lineItems: { quantity: number }[] };
    expect(input.tags).toContain("vault-pickup");
    expect(input.shippingLine).toMatchObject({ title: "Local Pickup", priceWithCurrency: { amount: "0.00" } });
    expect(input.lineItems.reduce((n, l) => n + l.quantity, 0)).toBe(3);
    const after = await db.pull.findMany();
    expect(after.every((p) => p.status === "FULFILLING" && p.shipOrderId === "gid://shopify/Order/777")).toBe(true);
    expect(await vaultedPulls(db, SHOP, viewer)).toHaveLength(0);
    const request = await db.shipRequest.findFirstOrThrow({ where: { status: "PAID" } });
    expect(request.pickup).toBe(true);

    // Staff tag the order "pickup-ready": the customer gets one Klaviyo email, then never again.
    const { notifyPickupsReady } = await import("./vault.server");
    let tags: string[] = [];
    const tagAdmin = {
      graphql: async (query: string, opts: { variables: Record<string, unknown> }) =>
        query.includes("PickupOrder(")
          ? new Response(JSON.stringify({ data: { order: { name: "#777", email: "fan@example.com", tags, cancelledAt: null } } }))
          : admin.graphql(query, opts),
    };
    const events: { metric: string; properties: Record<string, unknown> }[] = [];
    const realFetch = globalThis.fetch;
    process.env.KLAVIYO_PRIVATE_KEY = "test-key";
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      const a = JSON.parse(init.body).data.attributes;
      events.push({ metric: a.metric.data.attributes.name, properties: a.properties });
      return new Response("{}", { status: 202 });
    }) as never;
    try {
      expect(await notifyPickupsReady(db, async () => tagAdmin as never)).toBe(0);
      tags = ["vault-pickup", "pickup-ready"];
      expect(await notifyPickupsReady(db, async () => tagAdmin as never)).toBe(1);
      expect(await notifyPickupsReady(db, async () => tagAdmin as never)).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.KLAVIYO_PRIVATE_KEY;
    }
    expect(events).toHaveLength(1);
    expect(events[0].metric).toBe("Vault Pickup Ready");
    expect(events[0].properties).toMatchObject({ order_name: "#777", cards: 3 });
  });

  it("Return To Vault: removes an unpaid invoice, or cancels a paid unshipped order, and the cards go back reserved", async () => {
    const series = await makeReservedSeries(10);
    const { admin, drafts, deleted, edits } = vaultAdmin();
    await reservePool(db, admin, series.id);
    await launchSeries(db, series.id);
    const { pulls } = await drawForOrder(db, order(2));
    for (const p of pulls) await revealPull(db, SHOP, p.id, viewer);

    // Unpaid invoice.
    await requestShipment(db, admin, SHOP, viewer);
    const unpaid = (drafts[0].input as { customAttributes: { value: string }[] }).customAttributes[0].value;
    expect(await returnShipmentToVault(db, admin, SHOP, unpaid)).toEqual({ cards: 2, cancelledOrder: null });
    expect(deleted).toEqual(["gid://shopify/DraftOrder/1"]);
    expect(await vaultedPulls(db, SHOP, viewer)).toHaveLength(2);
    expect((await db.pull.findMany()).every((p) => p.unreservedAt === null && p.shipRequestId === null)).toBe(true);

    // Paid, not shipped yet.
    await requestShipment(db, admin, SHOP, viewer);
    const paid = (drafts[1].input as { customAttributes: { value: string }[] }).customAttributes[0].value;
    await markShipmentPaid(db, paid, "gid://shopify/Order/999");
    expect(await vaultedPulls(db, SHOP, viewer)).toHaveLength(0);
    expect(await returnShipmentToVault(db, admin, SHOP, paid)).toEqual({ cards: 2, cancelledOrder: "#999" });
    expect(edits.cancelled).toBe(true);
    const back = await db.pull.findMany();
    expect(back.every((p) => p.status === "REVEALED" && p.shipOrderId === null && p.shipRequestId === null && p.unreservedAt === null)).toBe(true);
    expect(await vaultedPulls(db, SHOP, viewer)).toHaveLength(2);
    expect((await db.shipRequest.findUniqueOrThrow({ where: { id: paid } })).status).toBe("RETURNED");
    await expect(returnShipmentToVault(db, admin, SHOP, paid)).rejects.toThrow(/already closed/);
  });

  it("keeps Shopify's reserved count in step with the app through repeated ship, return and add cycles", async () => {
    const series = await makeReservedSeries(10);
    const { admin, drafts, net } = vaultAdmin();
    await reservePool(db, admin, series.id);
    await launchSeries(db, series.id);
    const { pulls } = await drawForOrder(db, order(3));
    for (const p of pulls) await revealPull(db, SHOP, p.id, viewer);
    // Reserved copies in Shopify must always equal what the app's cards say is reserved.
    const inStep = async () => {
      for (const card of await db.card.findMany({ where: { seriesId: series.id } })) {
        expect(net(card.inventoryItemId!)).toBe(card.reservedQty);
      }
    };
    const requestId = (i: number) => (drafts[i].input as { customAttributes: { value: string }[] }).customAttributes[0].value;

    await requestShipment(db, admin, SHOP, viewer); // release #1
    await inStep();
    await returnShipmentToVault(db, admin, SHOP, requestId(0)); // unpaid invoice back to the vault
    await inStep();
    await requestShipment(db, admin, SHOP, viewer); // release #2 of the same pulls
    await inStep();
    await markShipmentPaid(db, requestId(1), "gid://shopify/Order/999");
    await returnShipmentToVault(db, admin, SHOP, requestId(1)); // paid order cancelled, cards back
    await inStep();
    await requestShipment(db, admin, SHOP, viewer); // release #3
    await inStep();
    await markShipmentPaid(db, requestId(2), "gid://shopify/Order/1000");
    // More cards opened later, then folded into the paid shipment.
    const more = await drawForOrder(db, order(2));
    for (const p of more.pulls) await revealPull(db, SHOP, p.id, viewer);
    await requestShipment(db, admin, SHOP, viewer); // a second invoice the add will cancel
    await inStep();
    expect(await addVaultCardsToShipment(db, admin, SHOP, requestId(2))).toBe(2);
    await inStep();
  });

  it("return guard: never re-reserves a copy Shopify doesn't show as available", async () => {
    const series = await makeReservedSeries(10);
    const base = fakeAdmin();
    let available = 0;
    const admin = {
      graphql: async (query: string, opts: { variables: Record<string, unknown> }) =>
        query.includes("RereserveAvailable")
          ? new Response(
              JSON.stringify({
                data: {
                  nodes: (opts.variables.ids as string[]).map((id) => ({
                    id,
                    inventoryLevels: { nodes: [{ location: { id: "gid://shopify/Location/1" }, quantities: [{ quantity: available }] }] },
                  })),
                },
              }),
            )
          : base.admin.graphql(query, opts),
    } as never;
    await reservePool(db, admin, series.id);
    await launchSeries(db, series.id);
    const { pulls } = await drawForOrder(db, order(1));
    await unreserveForPulls(db, admin, pulls.map((p) => p.id));
    const card = (await db.pull.findUniqueOrThrow({ where: { id: pulls[0].id }, include: { slot: true } })).slot.cardId;
    const item = (await db.card.findUniqueOrThrow({ where: { id: card } })).inventoryItemId!;
    const before = base.net(item);

    process.env.RESTOCK_WAIT_MS = "0";
    try {
      expect(await rereserveForPulls(db, admin, pulls.map((p) => p.id))).toEqual({ skipped: [pulls[0].id] });
      expect(base.net(item)).toBe(before); // nothing moved, so nothing went negative
      expect((await db.pull.findUniqueOrThrow({ where: { id: pulls[0].id } })).unreservedAt).not.toBeNull();

      available = 1; // the restock landed
      expect(await rereserveForPulls(db, admin, pulls.map((p) => p.id))).toEqual({ skipped: [] });
      expect(base.net(item)).toBe(before + 1);
    } finally {
      delete process.env.RESTOCK_WAIT_MS;
    }
  });

  it("ships free from the free-shipping card count", async () => {
    await openedVaultOrder(10);
    const { admin, drafts } = vaultAdmin();
    // Fewer than 25 cards pays the flat fee; the rule is checked directly at the threshold.
    await requestShipment(db, admin, SHOP, viewer);
    expect((drafts[0].input as { shippingLine: { priceWithCurrency: { amount: string } } }).shippingLine.priceWithCurrency.amount).toBe("5.00");
    const { shippingFeeFor } = await import("./vault.server");
    expect(shippingFeeFor(24)).toBe(5);
    expect(shippingFeeFor(25)).toBe(0);
  });

  it("puts cards back in the vault, reserved again, when the invoice lapses unpaid", async () => {
    await openedVaultOrder(2);
    const { admin, deleted } = vaultAdmin();
    await requestShipment(db, admin, SHOP, viewer);
    await expireShipments(db, async () => admin, new Date(Date.now() + 8 * 86_400_000));
    expect(deleted).toEqual(["gid://shopify/DraftOrder/1"]);
    const pulls = await db.pull.findMany();
    expect(pulls.every((p) => p.shipRequestId === null && p.unreservedAt === null && p.status === "REVEALED")).toBe(true);
    expect(await vaultedPulls(db, SHOP, viewer)).toHaveLength(2);
    expect((await db.shipRequest.findFirstOrThrow()).status).toBe("EXPIRED");
  });
});

describe("vault reminders", () => {
  it("reminds once, a month before the 12-month hold ends", async () => {
    const series = await makeReservedSeries(4);
    const { admin } = vaultAdmin();
    await reservePool(db, admin, series.id);
    await launchSeries(db, series.id);
    const viewer = { customerId: "gid://shopify/Customer/1" };
    const { pulls } = await drawForOrder(db, order(2));
    for (const p of pulls) await revealPull(db, SHOP, p.id, viewer);
    const tagged: unknown[] = [];
    const remindAdmin = {
      graphql: async (query: string, opts: { variables: Record<string, unknown> }) => {
        if (query.includes("VaultReminderTag")) tagged.push(opts.variables);
        return admin.graphql(query, opts);
      },
    };
    const { sendVaultReminders } = await import("./vault.server");
    // 300 days in: not yet.
    expect(await sendVaultReminders(db, async () => remindAdmin as never, new Date(Date.now() + 300 * 86_400_000))).toBe(0);
    // 340 days in: one reminder for this customer, then never again.
    const later = new Date(Date.now() + 340 * 86_400_000);
    expect(await sendVaultReminders(db, async () => remindAdmin as never, later)).toBe(1);
    expect(tagged).toHaveLength(1);
    expect(await sendVaultReminders(db, async () => remindAdmin as never, later)).toBe(0);
  });
});

describe("vault shipping is US only", () => {
  it("refuses Ship My Cards when the customer's order address is outside the US", async () => {
    const series = await makeReservedSeries(3);
    const { admin } = vaultAdmin();
    await reservePool(db, admin, series.id);
    await launchSeries(db, series.id);
    const viewer = { customerId: "gid://shopify/Customer/1" };
    const { pulls } = await drawForOrder(db, order(1));
    await revealPull(db, SHOP, pulls[0].id, viewer);
    const abroad = {
      graphql: async (query: string, opts: { variables: Record<string, unknown> }) =>
        query.includes("VaultOrderCountry")
          ? new Response(JSON.stringify({ data: { order: { shippingAddress: { countryCodeV2: "DE" }, billingAddress: null } } }))
          : admin.graphql(query, opts),
    };
    await expect(requestShipment(db, abroad as never, SHOP, viewer)).rejects.toThrow(/US addresses only/);
    expect(await db.shipRequest.count()).toBe(0);
  });
});

describe("vault pull notes", () => {
  it("keeps the order note under Shopify's 5000-character limit", async () => {
    const { noteVaultPulls } = await import("./orders.server");
    let note = "";
    const admin = {
      graphql: async (query: string, { variables }: { variables: Record<string, unknown> }) => {
        if (query.includes("PackOrderNote(")) return new Response(JSON.stringify({ data: { order: { note: "Gift for my son" } } }));
        note = (variables.input as { note: string }).note;
        return new Response(JSON.stringify({ data: { orderUpdate: { order: { id: "x" }, userErrors: [] } } }));
      },
    };
    const cards = Array.from({ length: 300 }, (_, i) => `Mega Lopunny ex - 084/094 ${i} - ME02 Phantasmal Flames Holofoil - Near Mint (Poke)`);
    await noteVaultPulls(admin as never, "gid://shopify/Order/1", cards);
    expect(note.length).toBeLessThanOrEqual(5000);
    expect(note.startsWith("Gift for my son")).toBe(true);
    expect(note).toMatch(/more \(full list in the app\)/);
  });
});

describe("guest orders", () => {
  it("attach to the account of a logged-in customer holding the order link", async () => {
    const series = await makeSeries(standardPool);
    await launchSeries(db, series.id);
    const guest = await drawForOrder(db, order(2, null));
    const viewer = { customerId: "gid://shopify/Customer/55", openToken: guest.packOrder!.openToken };
    expect(await pullsForViewer(db, SHOP, { customerId: viewer.customerId })).toHaveLength(0);

    expect(await pullsForViewer(db, SHOP, viewer)).toHaveLength(2); // logging in with the link claims them
    expect(await pullsForViewer(db, SHOP, { customerId: viewer.customerId })).toHaveLength(2);
    // Packs already tied to an account are never moved to another one.
    const ownedOrder = order(1);
    const owned = await drawForOrder(db, ownedOrder);
    expect(await claimGuestOrder(db, { customerId: viewer.customerId, openToken: owned.packOrder!.openToken })).toBe(0);
    expect((await db.pull.findMany({ where: { orderId: ownedOrder.orderId } }))[0].customerId).toBe("gid://shopify/Customer/1");
  });
});

describe("move a vault", () => {
  it("moves vault cards and unopened packs to another customer, leaving shipping cards alone", async () => {
    const series = await makeReservedSeries(10);
    const { admin } = vaultAdmin();
    await reservePool(db, admin, series.id);
    await launchSeries(db, series.id);
    const from = "gid://shopify/Customer/1";
    const to = "gid://shopify/Customer/2";
    const shipped = await drawForOrder(db, order(1));
    for (const p of shipped.pulls) await revealPull(db, SHOP, p.id, { customerId: from });
    const request = (await requestShipment(db, admin, SHOP, { customerId: from })) && (await db.shipRequest.findFirstOrThrow());
    // An unpaid invoice blocks the move until it's returned.
    await expect(moveVault(db, SHOP, from, to)).rejects.toThrow(/unpaid shipping invoice/);
    await markShipmentPaid(db, request.id, "gid://shopify/Order/999");

    const vaulted = await drawForOrder(db, order(2));
    await revealPull(db, SHOP, vaulted.pulls[0].id, { customerId: from });
    expect(await moveVault(db, SHOP, from, to, { dryRun: true })).toEqual({ cards: 1, unopened: 1, orders: 1 });
    expect(await pullsForViewer(db, SHOP, { customerId: to })).toHaveLength(0); // a preview changes nothing

    expect(await moveVault(db, SHOP, from, to)).toEqual({ cards: 1, unopened: 1, orders: 1 });
    expect(await vaultedPulls(db, SHOP, { customerId: to })).toHaveLength(1);
    expect((await pullsForViewer(db, SHOP, { customerId: to })).map((p) => p.status).sort()).toEqual(["REVEALED", "UNOPENED"]);
    // The card already shipping stays with the original customer.
    expect((await db.pull.findFirstOrThrow({ where: { shipRequestId: request.id } })).customerId).toBe(from);
    await expect(moveVault(db, SHOP, to, to)).rejects.toThrow(/same customer/);
  });

  it("finds a customer by ID, admin URL, or the email on their pack orders", async () => {
    await db.packOrder.create({
      data: { orderId: "gid://shopify/Order/31", shop: SHOP, orderName: "#31", customerId: "gid://shopify/Customer/77", openToken: "tok-31" },
    });
    const admin = {
      graphql: async (_q: string, opts: { variables: { query: string } }) =>
        new Response(
          JSON.stringify({
            data: { orders: { nodes: opts.variables.query.includes("pat@") ? [{ id: "gid://shopify/Order/31", email: "Pat@Example.com" }] : [] } },
          }),
        ),
    } as never;
    expect((await resolveCustomer(db, admin, "123")).customerId).toBe("gid://shopify/Customer/123");
    expect((await resolveCustomer(db, admin, "https://admin.shopify.com/store/x/customers/456")).customerId).toBe("gid://shopify/Customer/456");
    expect((await resolveCustomer(db, admin, "pat@example.com")).customerId).toBe("gid://shopify/Customer/77");
    await expect(resolveCustomer(db, admin, "other@example.com")).rejects.toThrow(/copy the number/);
    await expect(resolveCustomer(db, admin, "not an email")).rejects.toThrow(/isn't an email/);
  });
});
