import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  demoAccount,
  shopAction,
  shopperView,
  type Catalog,
  type ShopperState,
} from "./demo-shopper.server";
const common = {
  name: "Test printing",
  priceBits: 100,
  buybackBits: 80,
  cardbitValue: 100,
  tier: "Rare",
};
const catalog: Catalog = {
  cards: [
    { ...common, id: "pool-1", editionId: "pack" },
    { ...common, id: "single-1", editionId: null },
  ],
  packs: [
    {
      id: "pack",
      title: "Test Edition",
      priceBits: 100,
      cardsPerPack: 1,
      cardIds: ["pool-1"],
    },
  ],
};
const fresh = (): ShopperState => ({
  v: 1,
  version: "test",
  balance: 0,
  copies: [],
  packs: [],
  used: [],
  stock: {},
  shipments: [],
  orders: [],
  history: [],
  wants: [],
});
const topup = (amount = 100) => ({
  action: "topup",
  payment: "demo-4242",
  amount,
  requestId: randomUUID(),
});

describe("signed collector demo", () => {
  it.each([
    [1000, 0],
    [5000, 0],
    [10000, 500],
    [50000, 5000],
  ])("credits a %i top-up and its bonus once on the signed test account", (amount, bonus) => {
    const state = fresh();
    const payment = topup(amount);
    shopAction(state, catalog, { ...topup(amount), payment: "demo-0002" });
    shopAction(state, catalog, payment);
    shopAction(state, catalog, payment);
    expect(state.balance).toBe(amount + bonus);
    expect(state.history.map((entry) => entry.delta)).toEqual(bonus ? [0, amount, bonus] : [0, amount]);
    expect(shopperView(state, "Collector", "a").topupPromotions).toBe(true);
  });

  it("records a decline once, rejects changed confirmations, and reconciles approved funding", () => {
    const state = fresh(),
      declined = { ...topup(), payment: "demo-0002" };
    expect(shopAction(state, catalog, declined).approved).toBe(false);
    shopAction(state, catalog, declined);
    expect(state.history).toHaveLength(1);
    expect(() =>
      shopAction(state, catalog, { ...declined, payment: "demo-4242" }),
    ).toThrow("different action");
    expect(state.balance).toBe(0);
    expect(() =>
      shopAction(state, catalog, { ...topup(), payment: "live" }),
    ).toThrow();
    expect(() =>
      shopAction(state, catalog, { ...topup(), amount: 1.5 }),
    ).toThrow();
    const payment = topup(1000);
    shopAction(state, catalog, payment);
    shopAction(state, catalog, payment);
    expect(state.balance).toBe(1000);
  });
  it("keeps sealed copies hidden, charges once, and replays the original award", () => {
    const state = fresh(),
      purchase = {
        action: "open",
        id: "pack",
        openLater: true,
        requestId: randomUUID(),
      };
    expect(() => shopAction(state, catalog, purchase)).toThrow("Add Cardbits");
    shopAction(state, catalog, topup());
    const owned = shopAction(state, catalog, purchase);
    expect(shopAction(state, catalog, purchase)).toEqual(owned);
    const sealed = shopperView(state, "Collector", "a");
    expect(sealed.copies).toEqual([]);
    expect(sealed.openings[0].copyIds).toEqual([]);
    expect(state.balance).toBe(0);
    expect(state.orders).toHaveLength(1);
    const reveal = {
      action: "reveal",
      id: owned.openingId,
      requestId: randomUUID(),
    };
    shopAction(state, catalog, reveal);
    shopAction(state, catalog, reveal);
    expect(state.copies).toHaveLength(1);
    expect(state.used).toEqual(["pool-1"]);
    expect(state.copies[0].status).toBe("held");
    expect(() => shopAction(fresh(), catalog, reveal)).toThrow("unavailable");
    expect(() =>
      shopAction(state, catalog, { ...purchase, requestId: randomUUID() }),
    ).toThrow("sold out");
  });
  it("preserves individual ownership, completed orders and shipment locks after buying and selling", () => {
    const state = fresh();
    shopAction(state, catalog, topup(1000));
    const buy = () =>
      shopAction(state, catalog, {
        action: "buy",
        id: "single-1",
        requestId: randomUUID(),
      });
    const first = buy();
    expect(() => buy()).toThrow("sold out");
    shopAction(state, catalog, {
      action: "buyback",
      id: first.copyId,
      requestId: randomUUID(),
    });
    expect(state.orders[0].amount).toBe(100);
    expect(state.balance).toBe(980);
    const second = buy();
    const parcel = {
      action: "ship-group",
      copyIds: [second.copyId!],
      destination: "madison",
      requestId: randomUUID(),
    };
    expect(shopAction(state, catalog, parcel).shipmentId).toBeTruthy();
    shopAction(state, catalog, parcel);
    expect(state.shipments).toHaveLength(1);
    expect(state.orders).toHaveLength(2);
    expect(() =>
      shopAction(state, catalog, {
        action: "buyback",
        id: second.copyId,
        requestId: randomUUID(),
      }),
    ).toThrow("unavailable");
    expect(state.history.reduce((total, r) => total + r.delta, 0)).toBe(
      state.balance,
    );
  });
});

const dburl = process.env.TEST_DATABASE_URL;
let db: PrismaClient;
describe.skipIf(!dburl)("Postgres demo account isolation", () => {
  const shop = "demo-shopper-test.example",
    other = shop + "-other";
  beforeAll(() => {
    db = new PrismaClient({ datasources: { db: { url: dburl! } } });
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: dburl },
      stdio: "ignore",
    });
  });
  afterAll(async () => {
    await db.cardbitDemoAccount.deleteMany({
      where: { shop: { in: [shop, other] } },
    });
    await db.$disconnect();
  });
  it("preserves purchases across a buylist revision and prevents stale quotes or retired sales", async () => {
    const customer = randomUUID(),
      seed = fresh();
    const run = (input?: Parameters<typeof demoAccount>[5]) =>
      demoAccount(db, shop, customer, seed, catalog, input);
    await run(topup(200));
    const buy = { action: "buy", id: "single-1", requestId: randomUUID() };
    const purchased = await run(buy);
    const newer = { ...seed, version: "new-buylist" };
    const revised: Catalog = {
      cards: [],
      packs: [{ ...catalog.packs[0], cardIds: [] }],
      archivedCards: [catalog.cards[1]],
      replacesVersion: seed.version,
    };
    const updated = (
      input?: Parameters<typeof demoAccount>[5],
      quoted?: string,
    ) => demoAccount(db, shop, customer, newer, revised, input, quoted);
    const reads = await Promise.all([updated(), updated()]);
    for (const r of reads)
      expect(r.state).toEqual({ ...purchased.state, version: newer.version });
    expect((await updated(buy, seed.version)).result).toEqual(purchased.result);
    await expect(
      updated({ ...buy, requestId: randomUUID() }, seed.version),
    ).rejects.toThrow("Review your selection");
    await expect(updated({ ...buy, requestId: randomUUID() })).rejects.toThrow(
      "sold out",
    );
    await expect(
      updated({
        action: "buyback",
        id: purchased.result.copyId,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow("No buyback");
    await expect(
      updated({ action: "open", id: "pack", requestId: randomUUID() }),
    ).rejects.toThrow("sold out");
    expect(
      shopperView(reads[0].state, "Collector", "a", revised).historyCards,
    ).toHaveLength(1);
    await expect(run()).rejects.toThrow("Reload");
    const shipped = await updated({
      action: "ship-group",
      copyIds: [purchased.result.copyId!],
      destination: "madison",
      requestId: randomUUID(),
    });
    expect(shipped.state.balance).toBe(100);
    expect(shipped.state.orders).toEqual(purchased.state.orders);
    expect(shipped.state.shipments).toHaveLength(1);
  });
  it("locks concurrent confirmations, rolls back failed purchases and scopes by owner and shop", async () => {
    const account = randomUUID(),
      seed = fresh(),
      credit = topup(130);
    const run = (input?: Parameters<typeof demoAccount>[5]) =>
      demoAccount(db, shop, account, seed, catalog, input);
    await Promise.all([run(credit), run(credit), run()]);
    const purchases = await Promise.allSettled([
      run({ action: "buy", id: "single-1", requestId: randomUUID() }),
      run({ action: "buy", id: "single-1", requestId: randomUUID() }),
    ]);
    expect(purchases.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const owned = (await run()).state;
    expect(owned.balance).toBe(30);
    expect(owned.orders).toHaveLength(1);
    expect(
      (await demoAccount(db, other, account, seed, catalog)).state.orders,
    ).toEqual([]);
    expect(
      (await demoAccount(db, shop, randomUUID(), seed, catalog)).state.copies,
    ).toEqual([]);
  });
});
