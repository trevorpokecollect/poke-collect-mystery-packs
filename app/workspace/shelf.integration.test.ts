import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import {
  receiveCopies,
  confirmFiled,
  bindNativeSlots,
  type Intake,
} from "./shelf.server";
import { staffShipping } from "./fulfillment.server";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("numbered vault custody in PostgreSQL", () => {
  const key = "shelf-" + randomUUID(),
    variant = "gid://shopify/ProductVariant/872523",
    location = "gid://shopify/Location/7001";
  const order = "gid://shopify/Order/872523",
    fo = "gid://shopify/FulfillmentOrder/872523";
  const row = (i: number, qty = 1): Intake => ({
    eventKey: key + ":" + i,
    variantId: i === 1 ? variant : variant + String(i),
    quantity: qty,
    title: "Storage test " + i,
    game: "Pokemon",
    setName: key,
    name: "Storage test " + i,
    number: String(i),
    finish: "Holofoil",
    language: "English",
    condition: "Near Mint",
    locationId: location,
  });
  let db: PrismaClient,
    seriesId = "";
  beforeAll(async () => {
    execFileSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" },
    );
    db = new PrismaClient({ datasources: { db: { url } } });
  });
  afterAll(async () => {
    if (!db) return;
    await db.cardbitShelfBinding.deleteMany({
      where: {
        shop,
        copyId: {
          in: (
            await db.cardbitShelfCopy.findMany({
              where: { eventKey: { startsWith: key } },
              select: { id: true },
            })
          ).map((x) => x.id),
        },
      },
    });
    await db.cardbitShelfCopy.deleteMany({
      where: { eventKey: { startsWith: key } },
    });
    await db.cardbitShelfReceipt.deleteMany({
      where: { eventKey: { startsWith: key } },
    });
    await db.cardbitShelfParcel.deleteMany({ where: { shop, id: fo } });
    if (seriesId) await db.series.delete({ where: { id: seriesId } });
    await db.$disconnect();
  });
  it("reuses free space, separates duplicates under concurrent intake and releases only the packed copy after success", async () => {
    await Promise.all([
      receiveCopies(db, row(1, 2)),
      receiveCopies(db, row(1, 2)),
    ]);
    await expect(receiveCopies(db, row(1, 3))).rejects.toThrow(/different/);
    const duplicates = await db.cardbitShelfCopy.findMany({
      where: { eventKey: row(1).eventKey },
      orderBy: { slot: "asc" },
    });
    expect(duplicates).toHaveLength(2);
    expect(duplicates[0].slot).toBe(1);
    expect(duplicates[1].slot).toBe(2);
    await Promise.all(
      Array.from({ length: 19 }, (_, i) => receiveCopies(db, row(i + 2))),
    );
    expect(await db.cardbitShelfCopy.count({ where: { shop, slot: 1 } })).toBe(
      20,
    );
    await Promise.all(duplicates.map((c) => confirmFiled(db, c.id, c.slot!)));
    const series = await db.series.create({
      data: {
        shop,
        title: "Shelf fixture",
        handle: key,
        packPrice: 1,
        packProductId: key,
        packVariantId: key,
      },
    });
    seriesId = series.id;
    const card = await db.card.create({
      data: {
        seriesId,
        variantId: variant,
        productId: key,
        title: "Fixture",
        tier: "Base",
        marketValue: 1,
        quantity: 1,
        locationId: location,
      },
    });
    const native = await db.slot.create({
      data: { cardId: card.id, seriesId },
    });
    await db.$transaction((tx) => bindNativeSlots(tx, [native.id]));
    const reserved = await db.cardbitShelfCopy.findUniqueOrThrow({
      where: { poolSlotId: native.id },
    });
    let writes = 0,
      fail = true,
      paid = true,
      closed = false,
      tracking = "",
      labelWrites = 0;
    const conn = <T>(nodes: T[]) => ({
      nodes,
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    const admin = {
      graphql: async (
        q: string,
        opts: { variables: Record<string, unknown> },
      ) => {
        let data: unknown;
        if (q.includes("query ShelfOrder("))
          data = {
            order: {
              id: order,
              name: "#123",
              test: false,
              cancelledAt: null,
              displayFinancialStatus: paid ? "PAID" : "PENDING",
              shippingLine: { title: "Ground" },
              fulfillmentOrders: conn([
                {
                  id: fo,
                  status: closed ? "CLOSED" : "OPEN",
                  supportedActions: [{ action: "CREATE_FULFILLMENT" }],
                  deliveryMethod: { methodType: "SHIPPING" },
                  assignedLocation: {
                    name: "Store",
                    location: { id: location, isFulfillmentService: false },
                  },
                },
              ]),
            },
          };
        else if (q.includes("ShelfLines("))
          data = {
            fulfillmentOrder: {
              lineItems: conn([
                {
                  id: "line1",
                  remainingQuantity: closed ? 0 : 1,
                  totalQuantity: 1,
                  lineItem: {
                    id: "item1",
                    name: "Fixture",
                    title: "Fixture",
                    customAttributes: [],
                    variant: { id: variant },
                    requiresShipping: true,
                  },
                },
              ]),
            },
          };
        else if (q.includes("ShelfFulfillments("))
          data = {
            fulfillmentOrder: {
              fulfillments: conn(
                closed
                  ? [
                      {
                        id: "shipment",
                        status: "SUCCESS",
                        trackingInfo: [{ number: tracking }],
                      },
                    ]
                  : [],
              ),
            },
          };
        else if (q.includes("ShelfFulfilledLines("))
          data = {
            node: {
              fulfillmentLineItems: conn([
                { quantity: 1, lineItem: { id: "item1" } },
              ]),
            },
          };
        else if (q.includes("mutation ShelfLabel(")) {
          labelWrites++;
          data = {
            shippingLabelPurchase: {
              shippingLabelPurchaseResult: {
                id: "labeljob",
                status: "PENDING_PURCHASE",
              },
              userErrors: [],
            },
          };
        } else if (q.includes("ShelfLabelStatus("))
          data = {
            node: {
              status: "PURCHASED",
              errors: [],
              shippingLabels: [
                {
                  trackingInfo: { number: "TRK99", company: "UPS" },
                  shippingDocuments: [],
                },
              ],
            },
          };
        else if (q.includes("mutation ShelfShip(")) {
          writes++;
          if (fail)
            data = {
              fulfillmentCreate: {
                fulfillment: null,
                userErrors: [{ message: "Provider declined" }],
              },
            };
          else {
            closed = true;
            tracking = "TRK99";
            expect(opts.variables.fulfillment).toMatchObject({
              lineItemsByFulfillmentOrder: [
                {
                  fulfillmentOrderId: fo,
                  fulfillmentOrderLineItems: [{ id: "line1", quantity: 1 }],
                },
              ],
            });
            throw Error("Lost response");
          }
        } else throw Error("Unexpected query");
        return Response.json({ data });
      },
    } as unknown as AdminApiContext;
    const action = (action: string, fields = {}) =>
      staffShipping(
        db,
        admin,
        { action, id: order, fo, ...fields },
        "test-owner",
      );
    paid = false;
    await expect(action("prepareShipment")).rejects.toThrow(/Payment/);
    paid = true;
    const [a, b] = await Promise.all([
      action("prepareShipment"),
      action("prepareShipment"),
    ]);
    expect(a).toEqual(b);
    const parcel = await db.cardbitShelfParcel.findUniqueOrThrow({
      where: { id: fo },
    });
    const { picks } = parcel.manifest as unknown as {
        picks: { id: string; slot: number }[];
      },
      fields = { revision: parcel.revision };
    expect(picks).toHaveLength(1);
    expect(picks[0].id).not.toBe(reserved.id);
    await expect(
      action("packShipment", { ...fields, checked: [] }),
    ).rejects.toThrow(/every/);
    await action("packShipment", { ...fields, checked: [picks[0].id] });
    const label = {
      ounces: 5,
      shippingDatetime: new Date(Date.now() + 86400000).toISOString(),
    };
    await Promise.allSettled([
      action("buyLabel", { ...fields, label }),
      action("buyLabel", { ...fields, label }),
    ]);
    expect(labelWrites).toBe(1);
    await action("labelStatus");
    expect(
      (
        await db.cardbitShelfCopy.findUniqueOrThrow({
          where: { id: picks[0].id },
        })
      ).slot,
    ).toBe(picks[0].slot);
    await expect(action("shipParcel", fields)).rejects.toThrow(/declined/);
    fail = false;
    await expect(action("shipParcel", fields)).rejects.toThrow(/Lost/);
    await action("shipParcel", fields);
    await action("checkShipment", fields);
    expect(writes).toBe(2);
    expect(
      await db.cardbitShelfCopy.findUnique({ where: { id: picks[0].id } }),
    ).toMatchObject({ slot: null, lastSlot: picks[0].slot });
    expect(
      (
        await db.cardbitShelfCopy.findUniqueOrThrow({
          where: { id: reserved.id },
        })
      ).slot,
    ).toBe(reserved.slot);
    // New same-name copy cannot share divider 1 with the reserved copy. It refills divider 2.
    await receiveCopies(db, { ...row(1), eventKey: key + ":replacement" });
    expect(
      (
        await db.cardbitShelfCopy.findFirstOrThrow({
          where: { eventKey: key + ":replacement" },
        })
      ).slot,
    ).toBe(picks[0].slot);
  }, 60000);
});
