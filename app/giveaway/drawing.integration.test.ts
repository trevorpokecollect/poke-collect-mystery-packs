import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { drawWindow } from "./rules";
import { manage, customerView, ownerView, promptView } from "./service.server";
import {
  capturePaidEntries,
  enterOrBonus,
  lockDesk,
  reviewPaidEntries,
  recordReferralPurchase,
} from "./entries.server";
import { settleRound } from "./draw.server";
import { reverseReferralOrder } from "./purchases.server";
export function giveawaySuite(database: PrismaClient, enabled: boolean) {
  const id = (n: number) => "gid://shopify/Customer/" + n;
  const admin = (eligible: string[]) =>
    ({
      graphql: async (_q: string, opts: { variables: { ids: string[] } }) =>
        Response.json({
          data: {
            nodes: opts.variables.ids.map((id) => ({
              id,
              defaultEmailAddress: {
                marketingState: eligible.includes(id)
                  ? "SUBSCRIBED"
                  : "UNSUBSCRIBED",
              },
            })),
          },
        }),
    }) as unknown as AdminApiContext;
  describe.skipIf(!enabled)("giveaway ledger and payout", () => {
    afterAll(() => {
      vi.useRealTimers();
    });
    it("handles enrollment, referral conversion, race retries, refunds, daily reset and one wallet prize", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-23T20:00:00Z"));
      const { day, closesAt } = drawWindow(new Date());
      const [a, b, c] = [id(101), id(102), id(103)];
      await manage(database, "owner", {
        intent: "settings",
        enabled: true,
        rulesUrl: "/pages/rules",
        freeInstructions: "Fixture free method",
        referralEntries: 500,
        shareEntries: 100,
      });
      await expect(
        enterOrBonus(database, a, { intent: "enter" }),
      ).rejects.toThrow("Visit Whatnot");
      await expect(
        enterOrBonus(database, a, {
          intent: "whatnot",
          adult: false,
          region: "AL",
        }),
      ).rejects.toThrow("18");
      await expect(
        enterOrBonus(database, a, {
          intent: "whatnot",
          adult: true,
          region: "PR",
        }),
      ).rejects.toThrow();
      await enterOrBonus(database, a, {
        intent: "whatnot",
        adult: true,
        region: "AL",
      });
      expect((await customerView(database, a, true)).total).toBe(100);
      expect((await customerView(database, a, true)).entered).toBe(false);
      expect(await promptView(database, a)).toMatchObject({
        entered: false,
        whatnotDone: true,
        day,
      });
      await expect(
        enterOrBonus(database, a, {
          intent: "enter",
          expectedDay: "1999-01-01",
        }),
      ).rejects.toThrow("draw changed");
      const taps = await Promise.all(
        [1, 2].map(() =>
          enterOrBonus(database, a, { intent: "enter", expectedDay: day }),
        ),
      );
      expect(taps).toEqual(
        Array(2).fill({ day, entered: true, dailyEntries: 1 }),
      );
      expect((await customerView(database, a, true)).byKind.daily).toBe(1);
      expect(await promptView(database, a)).toMatchObject({ entered: true });
      for (const n of ["facebook", "instagram"])
        await Promise.all(
          [1, 2].map(() =>
            enterOrBonus(database, a, { intent: "social", network: n }),
          ),
        );
      await Promise.all(
        [1, 2].map(() => enterOrBonus(database, a, { intent: "share" })),
      );
      const first = await customerView(database, a, true);
      expect(first.total).toBe(301);
      await enterOrBonus(database, b, {
        intent: "whatnot",
        adult: true,
        region: "DC",
        ref: first.refCode,
      });
      await enterOrBonus(database, b, { intent: "enter" });
      expect(
        (await customerView(database, a, true)).byKind.referral,
      ).toBeUndefined();
      await database.$transaction(async (tx) => {
        await capturePaidEntries(tx, shop, {
          id: "qa-order",
          customerId: b,
          amount: 10000,
          paidCents: 10000,
        });
        await capturePaidEntries(tx, shop, {
          id: "qa-order",
          customerId: b,
          amount: 10000,
          paidCents: 10000,
        });
        await capturePaidEntries(tx, shop, {
          id: "qa-promo",
          customerId: b,
          amount: 500,
          paidCents: 0,
        });
        await recordReferralPurchase(tx, shop, b, "qa-order");
        await recordReferralPurchase(tx, shop, b, "second-order");
      });
      expect((await customerView(database, a, true)).byKind.referral).toBe(500);
      expect((await customerView(database, b, true)).byKind.purchase).toBe(100);
      await database.$transaction(async (tx) => {
        await lockDesk(tx);
        await reviewPaidEntries(tx, shop, "qa-order");
      });
      await reverseReferralOrder(database, shop, "qa-order");
      expect(
        (await customerView(database, a, true)).byKind.referral,
      ).toBeUndefined();
      expect(
        (await customerView(database, b, true)).byKind.purchase,
      ).toBeUndefined();
      await database.$transaction((tx) =>
        recordReferralPurchase(tx, shop, b, "new-paid-order"),
      );
      expect((await customerView(database, a, true)).byKind.referral).toBe(500);
      await enterOrBonus(database, c, {
        intent: "whatnot",
        adult: true,
        region: "AL",
      });
      await enterOrBonus(database, c, { intent: "enter" });
      await manage(database, "owner", {
        intent: "hold",
        customerId: c,
        reason: "Fixture review",
      });
      expect(await settleRound(database, admin([a, b, c]), day)).toBe(false);
      vi.setSystemTime(closesAt);
      await Promise.all(
        [1, 2].map(() => settleRound(database, admin([a, c]), day)),
      );
      const paid = await database.cardbitReceipt.findMany({
        where: { shop, kind: "giveaway-prize" },
      });
      expect(paid).toHaveLength(1);
      expect(paid[0]).toMatchObject({
        customerId: a,
        delta: 10000,
        qualifyingPaidCents: 0,
      });
      expect(
        (
          await database.cardbitWallet.findFirstOrThrow({
            where: { shop, customerId: a },
          })
        ).balance,
      ).toBe(10000);
      const history = await ownerView(database, { day });
      expect(history.rounds.find((r) => r.day === day)).toMatchObject({
        participantCount: 1,
        totalEntries: 801,
      });
      expect((await customerView(database, a, true)).total).toBe(0);
      await enterOrBonus(database, a, { intent: "enter" });
      await enterOrBonus(database, a, {
        intent: "social",
        network: "facebook",
      });
      await enterOrBonus(database, a, { intent: "share" });
      expect((await customerView(database, a, true)).total).toBe(101);
    });
    it("carries an unused Whatnot click to the first entry and closes a draw with no eligible entrants", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-12-01T20:00Z"));
      const person = id(221);
      const { day, closesAt } = drawWindow(new Date());
      await manage(database, "owner", {
        intent: "settings",
        enabled: true,
        rulesUrl: "/pages/rules",
        freeInstructions: "Fixture free method",
        referralEntries: 500,
        shareEntries: 100,
      });
      await enterOrBonus(database, person, {
        intent: "whatnot",
        region: "AL",
        adult: true,
      });
      vi.setSystemTime(closesAt);
      expect(await settleRound(database, admin([]), day)).toBe(true);
      expect(
        (
          await database.cardbitGiveawayRound.findUniqueOrThrow({
            where: { shop_day: { shop, day } },
          })
        ).winnerId,
      ).toBe(null);
      await enterOrBonus(database, person, { intent: "enter" });
      expect((await customerView(database, person, true)).total).toBe(101);
      await enterOrBonus(database, person, {
        intent: "whatnot",
        region: "AL",
        adult: true,
      });
      expect((await customerView(database, person, true)).total).toBe(101);
    });
  });
}
// CI and local verification share a database with the wallet and shelf suites.
// Each drawing run installs its own schema so a fixture payout cannot fund another test.
const source = new URL(
  process.env.TEST_DATABASE_URL || "postgresql://localhost/unconfigured_test",
);
const local = ["localhost", "127.0.0.1", "[::1]"].includes(source.hostname);
const configured =
  local &&
  ((process.env.GITHUB_ACTIONS === "true" &&
    source.pathname === "/packs_test") ||
    (process.env.CARDBIT_GIVEAWAY_QA_DB === "1" &&
      /^\/cardbit_giveaway_test(?:_[a-f0-9]{12})?$/.test(source.pathname)));
const schema = "giveaway_test_" + randomUUID().replaceAll("-", "");
source.searchParams.set("schema", schema);
const url = source.toString();
describe.skipIf(!configured)("PostgreSQL giveaway and numbered storage", () => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  let created = false;
  let original: Awaited<ReturnType<typeof custody>>;
  const copyId = "giveaway-custody-fixture";
  async function custody() {
    const copy = await db.cardbitShelfCopy.findUniqueOrThrow({
      where: { id: copyId },
    });
    const binding = await db.cardbitShelfBinding.findUniqueOrThrow({
      where: { poolSlotId: copyId },
    });
    return { copy, binding };
  }
  beforeAll(async () => {
    await db.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"');
    created = true;
    execFileSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      {
        env: { ...process.env, DATABASE_URL: url },
        stdio: "pipe",
      },
    );
    await db.cardbitShelfReceipt.create({
      data: { shop, eventKey: copyId, digest: copyId, quantity: 1 },
    });
    await db.cardbitShelfCopy.create({
      data: {
        id: copyId,
        shop,
        eventKey: copyId,
        unit: 1,
        variantId: "fixture",
        lookKey: "fixture",
        faceKey: "fixture",
        title: "Filed single",
        details: "Fixture",
        slot: 237,
        pocket: 4,
        filedAt: new Date(),
        poolSlotId: copyId,
      },
    });
    await db.cardbitShelfBinding.create({
      data: { shop, poolSlotId: copyId, copyId },
    });
    original = await custody();
  });
  giveawaySuite(db, configured);
  afterAll(async () => {
    try {
      if (original) expect(await custody()).toEqual(original);
    } finally {
      try {
        if (created)
          await db.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE');
      } finally {
        await db.$disconnect();
      }
    }
  });
});
