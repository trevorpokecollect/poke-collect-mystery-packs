import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { receiveCopies, confirmFiled } from "./shelf.server";
import { staffShipping } from "./fulfillment.server";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("pick list swap and remove in PostgreSQL", () => {
  const key = "pick-" + randomUUID(),
    n = String(Date.now()).slice(-9),
    variant = "gid://shopify/ProductVariant/9" + n,
    location = "gid://shopify/Location/9" + n,
    order = "gid://shopify/Order/9" + n,
    fo = "gid://shopify/FulfillmentOrder/9" + n;
  let db: PrismaClient;
  beforeAll(async () => {
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "ignore",
    });
    db = new PrismaClient({ datasources: { db: { url } } });
  });
  afterAll(async () => {
    if (!db) return;
    await db.cardbitShelfCopy.deleteMany({ where: { eventKey: { startsWith: key } } });
    await db.cardbitShelfReceipt.deleteMany({ where: { eventKey: { startsWith: key } } });
    await db.cardbitShelfParcel.deleteMany({ where: { shop, id: fo } });
    await db.$disconnect();
  });
  it("swaps a wrong copy for another filed copy, removes a card and keeps the last one", async () => {
    await receiveCopies(db, {
      eventKey: key,
      variantId: variant,
      quantity: 3,
      title: "Pick test",
      game: "Pokemon",
      setName: key,
      name: "Pick test",
      number: "7",
      finish: "Holofoil",
      language: "English",
      condition: "Near Mint",
      locationId: location,
    });
    const copies = await db.cardbitShelfCopy.findMany({ where: { eventKey: key } });
    await Promise.all(copies.map((c) => confirmFiled(db, c.id, c.slot!)));
    const conn = <T>(nodes: T[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
    const admin = {
      graphql: async (q: string) => {
        let data: unknown;
        if (q.includes("query ShelfOrder("))
          data = {
            order: {
              id: order, name: "#9", test: false, cancelledAt: null,
              displayFinancialStatus: "PAID", shippingLine: { title: "Free Shipping" },
              customAttributes: [],
              fulfillmentOrders: conn([
                {
                  id: fo, status: "OPEN",
                  supportedActions: [{ action: "CREATE_FULFILLMENT" }],
                  deliveryMethod: { methodType: "SHIPPING" },
                  assignedLocation: { name: "Store", location: { id: location, isFulfillmentService: false } },
                },
              ]),
            },
          };
        else if (q.includes("ShelfLines("))
          data = {
            fulfillmentOrder: {
              lineItems: conn([
                {
                  id: "line1", remainingQuantity: 2, totalQuantity: 2,
                  lineItem: { id: "item1", name: "Pick test", title: "Pick test", customAttributes: [], variant: { id: variant }, requiresShipping: true },
                },
              ]),
            },
          };
        else if (q.includes("ShelfFulfillments(")) data = { fulfillmentOrder: { fulfillments: conn([]) } };
        else throw Error("Unexpected query " + q.slice(0, 40));
        return Response.json({ data });
      },
    } as unknown as AdminApiContext;
    const act = (action: string, fields = {}) =>
      staffShipping(db, admin, { action, id: order, fo, ...fields }, "test-owner");
    const first = (await act("prepareShipment")) as unknown as { picks: { id: string }[]; revision: string };
    expect(first.picks).toHaveLength(2);
    const spare = copies.find((c) => !first.picks.some((p) => p.id === c.id))!;
    const wrong = first.picks[0].id;
    await act("packShipment", { revision: first.revision, checked: first.picks.map((p) => p.id) });
    await expect(act("swapPick", { revision: "stale", pick: wrong })).rejects.toThrow(/changed/);
    const swapped = (await act("swapPick", { revision: first.revision, pick: wrong })) as unknown as {
      picks: { id: string }[]; revision: string; state: string; coversAll: boolean;
    };
    expect(swapped.state).toBe("READY");
    expect(swapped.picks.map((p) => p.id).sort()).toEqual([first.picks[1].id, spare.id].sort());
    expect(await db.cardbitShelfCopy.findUniqueOrThrow({ where: { id: wrong } })).toMatchObject({ parcelId: null, filedAt: null });
    await expect(act("swapPick", { revision: swapped.revision, pick: spare.id })).rejects.toThrow(/No other filed copy/);
    const removed = (await act("removePick", { revision: swapped.revision, pick: spare.id })) as unknown as {
      picks: { id: string }[]; lines: { quantity: number }[]; revision: string; coversAll: boolean;
    };
    expect(removed.picks).toHaveLength(1);
    expect(removed.lines).toEqual([expect.objectContaining({ quantity: 1 })]);
    expect(removed.coversAll).toBe(false);
    await expect(act("removePick", { revision: removed.revision, pick: removed.picks[0].id })).rejects.toThrow(/last card/);
  }, 60000);
});
