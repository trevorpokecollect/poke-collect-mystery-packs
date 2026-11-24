import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { inventoryTotals } from "./totals.server";

const url = process.env.TEST_DATABASE_URL;
const variant = (price: string, type: string, levels: number[], status = "ACTIVE") => ({
  price,
  product: { status, productType: type },
  inventoryItem: {
    tracked: true,
    inventoryLevels: { nodes: levels.map((quantity) => ({ quantities: [{ quantity }] })) },
  },
});
const admin = {
  graphql: async () =>
    new Response(
      JSON.stringify({
        data: {
          productVariants: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              variant("2.50", "Pokemon Single", [3, 1]),
              variant("10.00", "Pokemon Japanese Single", [2]),
              variant("9.99", "Mystery Pack", [40]),
              variant("5.00", "Pokemon Single", [0, -2]),
              variant("7.00", "Pokemon Single", [4], "DRAFT"),
            ],
          },
        },
      }),
    ),
} as never;

describe.skipIf(!url)("Cardbit inventory totals in disposable PostgreSQL", () => {
  let db: PrismaClient;
  const tag = randomUUID().slice(0, 8);
  beforeAll(async () => {
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "ignore",
    });
    db = new PrismaClient({ datasources: { db: { url } } });
  });
  afterAll(async () => {
    if (!db) return;
    await db.cardbitBuyback.deleteMany({ where: { shop, copy: { orderName: { startsWith: "#T" + tag } } } });
    await db.pull.deleteMany({ where: { shop, orderName: { startsWith: "#T" + tag } } });
    await db.packOrder.deleteMany({ where: { shop, orderName: { startsWith: "#T" + tag } } });
    await db.series.deleteMany({ where: { shop, handle: { startsWith: "totals-" + tag } } });
    await db.$disconnect();
  });
  it("totals pooled, listed and vaulted copies separately", async () => {
    // Other suites share this database, so compare against the totals before this test's rows.
    const before = await inventoryTotals(db, admin);
    const make = (status: "LIVE" | "CLOSED", n: string) =>
      db.series.create({
        data: {
          shop,
          title: "Totals " + n,
          handle: "totals-" + tag + "-" + n,
          status,
          staffTest: true,
          packProductId: "qa:p",
          packVariantId: "qa:" + tag + n,
          packPrice: 25,
          cards: {
            create: [
              { title: "A", variantId: "gid://shopify/ProductVariant/1" + n, productId: "p", tier: "Base", marketValue: 4.25, quantity: 3 },
            ],
          },
        },
        include: { cards: true },
      });
    const live = await make("LIVE", "1"),
      closed = await make("CLOSED", "2");
    const slot = (s: typeof live, position: number, claimed = false, voided = false) =>
      db.slot.create({ data: { seriesId: s.id, cardId: s.cards[0].id, position, claimed, voided } });
    await slot(live, 1);
    await slot(live, 2);
    await slot(live, 3, false, true);
    const won = await slot(live, 4, true),
      sealed = await slot(live, 5, true),
      soldBack = await slot(live, 6, true);
    await slot(closed, 1);
    const order = "gid://shopify/Order/" + tag.replace(/\D/g, "1");
    await db.packOrder.create({
      data: { orderId: order, shop, orderName: "#T" + tag, openToken: tag, vault: true },
    });
    const pull = (slotId: string, i: number, status: "REVEALED" | "UNOPENED", customerId: string) =>
      db.pull.create({
        data: {
          shop, seriesId: live.id, slotId, orderId: order, orderName: "#T" + tag,
          lineItemId: "li-" + tag, packIndex: i, customerId, status,
        },
      });
    await pull(won.id, 0, "REVEALED", "gid://shopify/Customer/1");
    await pull(sealed.id, 1, "UNOPENED", "gid://shopify/Customer/2");
    const gone = await pull(soldBack.id, 2, "REVEALED", "gid://shopify/Customer/1");
    await db.cardbitBuyback.create({
      data: { copyId: gone.id, shop, customerId: "gid://shopify/Customer/1", amount: 340, expiresAt: new Date(), acceptedAt: new Date() },
    });
    const t = await inventoryTotals(db, admin);
    const delta = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      Object.fromEntries(Object.keys(a).filter((k) => typeof a[k] === "number").map((k) => [k, Number(a[k]) - Number(b[k])]));
    expect(delta(t.packs, before.packs)).toMatchObject({ cards: 2, cents: 850, pools: 1 });
    expect(delta(t.vaults, before.vaults)).toMatchObject({ cards: 2, cents: 850, unopened: 1 });
    expect(t.listed).toMatchObject({ cards: 6, cents: 3000, listings: 2, partial: false });
  });
});
