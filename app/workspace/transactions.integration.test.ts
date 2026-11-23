import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { recordFunding } from "../lib/cardbits.server";
import { adjust, account } from "./customers.server";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)(
  "Cardbit workspace transactions in disposable PostgreSQL",
  () => {
    let db: PrismaClient;
    const customerId = "gid://shopify/Customer/9230000701",
      ids = { shop, customerId };
    beforeAll(async () => {
      execFileSync(
        process.execPath,
        ["node_modules/prisma/build/index.js", "migrate", "deploy"],
        { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" },
      );
      db = new PrismaClient({ datasources: { db: { url } } });
      await db.cardbitWallet.create({ data: { ...ids, balance: 1000 } });
    });
    afterAll(async () => {
      if (!db) return;
      await db.cardbitReceipt.deleteMany({ where: ids });
      await db.cardbitWallet.deleteMany({ where: ids });
      await db.$disconnect();
    });
    it("serializes test funding with staff changes and credits a repeated adjustment once", async () => {
      const event = randomUUID(),
        credit = () =>
          adjust(
            db,
            customerId,
            "wallet",
            278,
            "Service correction",
            event,
            "qa-owner",
          );
      await Promise.all([
        credit(),
        credit(),
        recordFunding(db, shop, {
          id: "qa-funding/" + randomUUID(),
          customerId,
          amount: 125,
        }),
      ]);
      const view = await account(db, customerId, "wallet");
      expect(view.balance).toBe(1403);
      expect(view.qualifying).toBe(0);
      expect(
        view.history.filter((t) => t.note === "Service correction"),
      ).toHaveLength(1);
      await expect(
        adjust(db, customerId, "wallet", 9, "Changed", event, "qa-owner"),
      ).rejects.toThrow();
      const results = await Promise.allSettled(
        [1, 2].map(() =>
          adjust(
            db,
            customerId,
            "wallet",
            -1200,
            "Correction",
            randomUUID(),
            "qa-owner",
          ),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await account(db, customerId, "wallet")).balance).toBe(203);
    });
  },
);
