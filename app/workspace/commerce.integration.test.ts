import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import {
  recordFunding,
  reviewFunding,
  walletAction,
  walletView,
} from "../lib/cardbits.server";
import { drawForOrder, launchSeries, revealPull } from "../lib/pool.server";
const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({
  datasources: { db: { url: url || "postgresql://localhost/disabled_test" } },
});
const who = "gid://shopify/Customer/99231",
  other = "gid://shopify/Customer/99232";
describe.skipIf(!url)("Cardbit live-mode wallet on disposable Postgres", () => {
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "ignore",
    });
    vi.stubEnv("CARDBIT_STOREFRONT_SHOP", shop);
    vi.stubEnv("CARDBIT_WORKSPACE_MODE", "live");
    vi.stubEnv("RAILWAY_PROJECT_NAME", "cardbit-mystery-packs");
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
    vi.stubEnv("RAILWAY_SERVICE_NAME", "app");
  });
  afterAll(async () => {
    const series = await db.series.findMany({
      where: { shop, handle: { startsWith: "wallet-contract-test-" } },
      select: { id: true },
    });
    const ids = series.map((s) => s.id);
    await db.cardbitReceipt.deleteMany({ where: { shop, customerId: who } });
    await db.pull.deleteMany({ where: { seriesId: { in: ids } } });
    await db.packOrder.deleteMany({ where: { shop, customerId: who } });
    await db.series.deleteMany({ where: { id: { in: ids } } });
    await db.cardbitWallet.deleteMany({ where: { shop, customerId: who } });
    vi.unstubAllEnvs();
    await db.$disconnect();
  });
  it("replays funding and bonuses once, reserves the last pack once, and holds disputed funding", async () => {
    const order = {
      id: "gid://shopify/Order/" + Date.now(),
      customerId: who,
      amount: 10000,
      paidCents: 10000,
      bonus: 500,
    };
    const initial = await db.cardbitWallet.findUnique({
      where: { shop_customerId: { shop, customerId: who } },
    });
    expect(initial).toBeNull();
    await Promise.all([
      recordFunding(db, shop, order),
      recordFunding(db, shop, order),
    ]);
    const receipts = await db.cardbitReceipt.findMany({
      where: { shop, customerId: who },
    });
    expect(
      receipts.map((r) => [r.kind, r.delta, r.qualifyingPaidCents]).sort(),
    ).toEqual([
      ["topup", 10000, 10000],
      ["topup-bonus", 500, 0],
    ]);
    const id = randomUUID(),
      variant = "wallet-real-" + id;
    const draft = await db.series.create({
      data: {
        shop,
        title: "Wallet test",
        handle: "wallet-contract-test-" + id,
        staffTest: false,
        packProductId: id,
        packVariantId: variant,
        packPrice: 100,
        cardsPerPack: 1,
        buildRules: { cardbitSalesChannel: "wallet" },
        cards: {
          create: {
            productId: id,
            variantId: id,
            title: "Physical card",
            tier: "Base",
            marketValue: 100,
            quantity: 1,
            reservedQty: 1,
          },
        },
      },
    });
    const live = await launchSeries(db, draft.id);
    const external = await drawForOrder(db, {
      shop,
      orderId: "external-" + id,
      orderName: "Shopify",
      customerId: other,
      lines: [
        { lineItemId: "external-" + id, variantId: variant, quantity: 1 },
      ],
    });
    expect(external.pulls).toHaveLength(0);
    const purchase = {
      action: "pack" as const,
      id: draft.id,
      amount: 10000,
      version: live.commitHash!,
      requestId: randomUUID(),
    };
    const [a, b] = await Promise.all([
      walletAction(db, shop, who, purchase),
      walletAction(db, shop, who, purchase),
    ]);
    expect(a.id).toBe(b.id);
    await expect(
      walletAction(db, shop, who, { ...purchase, requestId: randomUUID() }),
    ).rejects.toThrow();
    expect(await db.pull.count({ where: { seriesId: draft.id } })).toBe(1);
    await expect(
      revealPull(db, shop, a.openingId!, { customerId: other }),
    ).rejects.toThrow();
    const opened = await revealPull(db, shop, a.openingId!, {
      customerId: who,
    });
    expect(
      (await revealPull(db, shop, a.openingId!, { customerId: who })).cards,
    ).toEqual(opened.cards);
    expect(await walletView(db, shop, who)).toMatchObject({
      mode: "live",
      balance: 500,
      checkoutReady: false,
    });
    await Promise.all([
      reviewFunding(db, shop, order.id),
      reviewFunding(db, shop, order.id),
    ]);
    expect(await walletView(db, shop, who)).toMatchObject({ held: true });
    const counted = await db.cardbitReceipt.aggregate({
      where: { shop, customerId: who },
      _sum: { qualifyingPaidCents: true },
    });
    expect(counted._sum.qualifyingPaidCents).toBe(0);
  });
});
