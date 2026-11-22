import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CARDBIT_SHOP as shop } from "./cardbit.server";
import {
  recordFunding,
  reviewFunding,
  walletAction,
  walletView,
} from "./cardbits.server";
import {
  autoOpenDue,
  launchSeries,
  pullsForViewer,
  revealPull,
} from "./pool.server";
const url = process.env.TEST_DATABASE_URL;
const qa = "gid://shopify/Customer/101",
  other = "gid://shopify/Customer/102";
const ids = { shop, customerId: qa };
const db = new PrismaClient({
  datasources: {
    db: { url: url || "postgresql://localhost/unconfigured_test" },
  },
});

describe.skipIf(!url)("Cardbit transactional integration", () => {
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "ignore",
    });
    vi.stubEnv("CARDBIT_STOREFRONT_SHOP", shop);
    vi.stubEnv("CARDBIT_COMMERCE_MODE", "staging");
    vi.stubEnv("CARDBIT_QA_CUSTOMERS", qa + "," + other);
    vi.stubEnv("CARDBIT_TEST_SERIES", '{"collector-qa":100}');
  });
  afterAll(async () => {
    await db.cardbitBuyback.deleteMany({ where: { shop } });
    await db.pullTransfer.deleteMany({ where: { shop } });
    await db.pull.deleteMany({ where: { shop } });
    await db.packOrder.deleteMany({ where: { shop } });
    await db.series.deleteMany({ where: { shop, handle: "collector-qa" } });
    await db.cardbitReceipt.deleteMany({ where: { shop } });
    await db.cardbitWallet.deleteMany({ where: { shop } });
    await db.$disconnect();
    vi.unstubAllEnvs();
  });
  it("serializes funding, spending and one-copy buybacks, and replays the original five cards", async () => {
    const s = await db.series.create({
      data: {
        shop,
        staffTest: true,
        handle: "collector-qa",
        title: "Collector QA",
        packProductId: "qa-pack",
        packVariantId: "qa-pack-variant",
        packPrice: 1,
        cardsPerPack: 5,
        cards: {
          create: [
            {
              productId: "qa-card",
              variantId: "qa-card-variant",
              title: "Same printing",
              tier: "Base",
              marketValue: 1,
              quantity: 10,
            },
          ],
        },
      },
    });
    const live = await launchSeries(db, s.id);
    const topup = {
      id: "qa-funding-" + randomUUID(),
      customerId: qa,
      amount: 200,
    };
    const paid = await Promise.all([
      recordFunding(db, shop, topup),
      recordFunding(db, shop, topup),
    ]);
    expect(paid[0].id).toBe(paid[1].id);
    const buy = {
      action: "pack" as const,
      id: s.id,
      requestId: randomUUID(),
      amount: 100,
      version: live.commitHash!,
    };
    const [one, two] = await Promise.all([
      walletAction(db, shop, qa, buy),
      walletAction(db, shop, qa, buy),
    ]);
    expect(one.id).toBe(two.id);
    expect(await db.pull.count({ where: { shop, seriesId: s.id } })).toBe(5);
    await expect(
      walletAction(db, shop, qa, { ...buy, amount: 99 }),
    ).rejects.toThrow();
    const openingId = one.openingId!;
    const order = await db.packOrder.findFirstOrThrow({ where: ids });
    expect(
      await pullsForViewer(db, shop, { openToken: order.openToken }),
    ).toEqual([]);
    await expect(
      revealPull(db, shop, openingId, {
        customerId: other,
        openToken: order.openToken,
      }),
    ).rejects.toThrow();
    await autoOpenDue(db, new Date("2099-01-01"));
    expect(await db.pull.count({ where: { shop, status: "UNOPENED" } })).toBe(
      5,
    );
    const first = await revealPull(db, shop, openingId, { customerId: qa });
    expect(new Set(first.cards.map((c) => c.copyId)).size).toBe(5);
    const offer = await db.cardbitBuyback.create({
      data: {
        ...ids,
        copyId: first.cards[0].copyId,
        expiresAt: new Date(Date.now() + 3600000),
        amount: 50,
      },
    });
    const sell = {
      action: "buyback" as const,
      id: offer.copyId,
      version: offer.expiresAt.toISOString(),
      amount: offer.amount,
      requestId: randomUUID(),
    };
    await expect(walletAction(db, shop, other, sell)).rejects.toThrow();
    const replayed = await Promise.all([
      walletAction(db, shop, qa, sell),
      walletAction(db, shop, qa, sell),
    ]);
    expect(replayed[0].id).toBe(replayed[1].id);
    await expect(
      walletAction(db, shop, qa, { ...sell, requestId: randomUUID() }),
    ).rejects.toThrow();
    const history = await revealPull(db, shop, openingId, { customerId: qa });
    expect(history.cards.map((c) => c.copyId)).toEqual(
      first.cards.map((c) => c.copyId),
    );
    expect(await pullsForViewer(db, shop, { customerId: qa })).toHaveLength(4);
    expect(await walletView(db, shop, qa)).toMatchObject({ balance: 150 });
    await reviewFunding(db, shop, topup.id);
    await expect(
      walletAction(db, shop, qa, { ...buy, requestId: randomUUID() }),
    ).rejects.toThrow(/paused/);
    const refunded = "qa-refund-first-" + randomUUID();
    await reviewFunding(db, shop, refunded);
    await recordFunding(db, shop, {
      id: refunded,
      customerId: qa,
      amount: 999,
    });
    expect(await walletView(db, shop, qa)).toMatchObject({
      balance: 150,
      held: true,
    });
  });
});
