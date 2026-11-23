import { afterEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { vault } from "./portfolio.server";
import { initialPolicy } from "./model";
afterEach(() => vi.unstubAllEnvs());
it("keeps the Cardbits portfolio working and omits previously stored market history while permission is pending", async () => {
  vi.stubEnv("CARDBIT_TCGPLAYER_MARKET_APPROVED", "false");
  const key = "101|ja|holo|near mint",
    at = new Date(),
    variantId = "gid://shopify/ProductVariant/301";
  const ref = {
    key,
    name: "Test",
    set: "Test",
    number: "1",
    finish: "Holo",
    condition: "Near Mint",
    language: "Japanese",
    cash: 150,
    retail: 250,
    market: 9900,
    marketDate: "2026-11-22",
    retailDate: "2026-11-23",
    quoteSource: "merchant",
  };
  const tx = {
    $queryRaw: vi.fn(),
    cardbitDeskBook: {
      findUnique: async () => ({
        revision: 2,
        policy: initialPolicy,
        refreshedAt: at,
        references: { [key]: ref },
        variants: { [variantId]: key },
      }),
    },
    pull: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([{ orderId: "1" }])
        .mockResolvedValueOnce([
          { slot: { card: { variantId, title: "Test" } } },
        ]),
    },
    packOrder: { findMany: async () => [{ orderId: "1" }] },
    cardbitDeskTick: {
      findMany: async () => [{ key, at, bits: 200, market: 9900 }],
    },
    cardbitVaultMark: {
      upsert: vi.fn(),
      findMany: async () => [{ at, bits: 200, market: 9900 }],
    },
  };
  const db = {
    $transaction: (work: (t: unknown) => unknown) => work(tx),
  } as unknown as PrismaClient;
  const value = await vault(
    db,
    {} as AdminApiContext,
    "gid://shopify/Customer/1",
    "wallet",
  );
  expect(value).toMatchObject({
    marketApproved: false,
    market: null,
    bits: 200,
    history: [{ market: null, bits: 200 }],
    holdings: [
      {
        bits: 200,
        market: null,
        marketDate: null,
        history: [{ market: null, bits: 200 }],
      },
    ],
  });
  expect(tx.cardbitVaultMark.upsert.mock.calls[0][0].create.market).toBeNull();
});
