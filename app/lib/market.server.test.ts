// Runs against a real Postgres (TEST_DATABASE_URL), like the pool tests.
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drawForOrder, launchSeries, pullsForViewer, revealPull, voidPulls } from "./pool.server";
import {
  activityFeed,
  addWish,
  boardCards,
  buyWithCredit,
  catalog,
  collectionFor,
  collectors,
  cancelOffer,
  completeSale,
  createListing,
  createOffer,
  expireCheckouts,
  expireOffers,
  flagMarketOrder,
  hasMarketAccess,
  marketDemo,
  myMarketCards,
  myOffers,
  payOutSellers,
  removeWish,
  respondToOffer,
  sendWishlistAlerts,
  reverseSale,
  reverseTrade,
  setCollectionSettings,
  setOpenToTrade,
  setTradeName,
  startPurchase,
  tradeMatches,
  updateMarketSettings,
  wishlist,
} from "./market.server";
import { moveVault, requestShipment, vaultedPulls } from "./vault.server";
import { adjustCredit, createCreditCode, creditBalance, expireCreditCodes, refundCreditCodes, returnCreditCode, settleCreditCodes } from "./credit.server";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("Set TEST_DATABASE_URL to an empty Postgres database to run these tests.");

const db = new PrismaClient({ datasources: { db: { url } } });
const SHOP = "test-shop.myshopify.com";
const PACK = "gid://shopify/ProductVariant/1000";
const ANN = "gid://shopify/Customer/1";
const BEN = "gid://shopify/Customer/2";
const CAL = "gid://shopify/Customer/3";
let seriesId = "";

beforeAll(() => {
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
});
afterAll(() => db.$disconnect());
beforeEach(async () => {
  await db.wishItem.deleteMany();
  await db.creditTxn.deleteMany();
  await db.creditCode.deleteMany();
  await db.pullTransfer.deleteMany();
  await db.tradeItem.deleteMany();
  await db.trade.deleteMany();
  await db.listing.deleteMany();
  await db.trader.deleteMany();
  await db.marketSettings.deleteMany();
  await db.pull.deleteMany();
  await db.shipRequest.deleteMany();
  await db.packOrder.deleteMany();
  await db.series.deleteMany();
  seriesId = "";
  await updateMarketSettings(db, SHOP, { enabled: true, sellingEnabled: true, feePercent: 10 });
  await setTradeName(db, SHOP, ANN, "Ann");
  await setTradeName(db, SHOP, BEN, "Ben");
});

let seq = 0;

async function series() {
  const s = await db.series.create({
    data: {
      shop: SHOP,
      title: "Series",
      handle: `s-${++seq}`,
      packProductId: "gid://shopify/Product/1",
      packVariantId: PACK,
      packPrice: 10,
      cards: {
        create: Array.from({ length: 20 }, (_, i) => ({
          variantId: `gid://shopify/ProductVariant/${2000 + i}`,
          productId: `gid://shopify/Product/${2000 + i}`,
          title: `Card ${i}`,
          tier: "Poke",
          marketValue: 5,
          quantity: 1,
        })),
      },
    },
  });
  await launchSeries(db, s.id);
  seriesId = s.id;
}

/** Opened vault cards for a customer, aged past the trade wait. */
async function vaultCards(customerId: string, n: number, ageDays = 20) {
  if (!seriesId) await series();
  seq++;
  const { pulls } = await drawForOrder(db, {
    shop: SHOP,
    orderId: `gid://shopify/Order/${seq}`,
    orderName: `#${1000 + seq}`,
    customerId,
    lines: [{ lineItemId: `gid://shopify/LineItem/${seq}`, variantId: PACK, quantity: n }],
  });
  for (const p of pulls) await revealPull(db, SHOP, p.id, { customerId });
  await db.pull.updateMany({ where: { id: { in: pulls.map((p) => p.id) } }, data: { createdAt: new Date(Date.now() - ageDays * 86_400_000) } });
  return pulls.map((p) => p.id);
}

function fakeAdmin() {
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  let paidOrder: { id: string; name: string } | null = null;
  const admin = {
    graphql: async (query: string, { variables }: { variables: Record<string, unknown> } = { variables: {} }) => {
      calls.push({ query, variables });
      let data: unknown = {};
      if (query.includes("draftOrderCreate")) data = { draftOrderCreate: { draftOrder: { id: "gid://shopify/DraftOrder/1", invoiceUrl: "https://pay/1" }, userErrors: [] } };
      else if (query.includes("currencyCode")) data = { shop: { currencyCode: "USD" } };
      else if (query.includes("MarketDraftStatus")) data = { draftOrder: { id: "d", order: paidOrder } };
      else if (query.includes("draftOrderDelete")) data = { draftOrderDelete: { deletedId: "d", userErrors: [] } };
      else if (query.includes("discountCodeBasicCreate")) data = { discountCodeBasicCreate: { codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/1" }, userErrors: [] } };
      else if (query.includes("VaultCreditCodeUses")) data = { codeDiscountNode: { codeDiscount: { asyncUsageCount: 0 } } };
      else if (query.includes("discountCodeDelete")) data = { discountCodeDelete: { deletedCodeDiscountId: "x", userErrors: [] } };
      else if (query.includes("storeCreditAccountCredit")) data = { storeCreditAccountCredit: { storeCreditAccountTransaction: { id: "t" }, userErrors: [] } };
      else if (variables?.input && (variables.input as { changes?: unknown }).changes) data = { inventoryMoveQuantities: { userErrors: [] } };
      return new Response(JSON.stringify({ data }));
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: admin as any, calls, pay: (o: { id: string; name: string }) => (paidOrder = o) };
}

const owner = async (id: string) => (await db.pull.findUniqueOrThrow({ where: { id } })).customerId;

describe("trading", () => {
  it("swaps cards between vaults when the other player accepts", async () => {
    const [a1] = await vaultCards(ANN, 1);
    const [b1, b2] = await vaultCards(BEN, 2);
    await setOpenToTrade(db, SHOP, BEN, b1, true);

    const board = await boardCards(db, SHOP, ANN);
    expect(board.map((c) => c.pullId)).toEqual([b1]);
    expect(board[0].trader).toBe("Ben");
    expect(JSON.stringify(board)).not.toMatch(/marketValue|customerId|gid:\/\/shopify\/Customer/);

    const offer = await createOffer(db, SHOP, ANN, { give: [a1], get: [b1], note: "Fair Trade?" });
    expect((await myOffers(db, SHOP, BEN))[0]).toMatchObject({ incoming: true, with: "Ann" });

    await respondToOffer(db, SHOP, BEN, offer.id, "accept");
    expect(await owner(a1)).toBe(BEN);
    expect(await owner(b1)).toBe(ANN);
    expect(await owner(b2)).toBe(BEN);
    expect((await db.pull.findUniqueOrThrow({ where: { id: b1 } })).openToTrade).toBe(false);
    expect(await db.pullTransfer.count()).toBe(2);
    // The new owner can ship it; the old owner can't.
    expect((await vaultedPulls(db, SHOP, { customerId: ANN })).map((p) => p.id)).toEqual([b1]);
  });

  it("refuses cards still in the refund wait, cards not open to trade and free-text notes", async () => {
    const [fresh] = await vaultCards(ANN, 1, 3);
    const [a1] = await vaultCards(ANN, 1);
    const [b1] = await vaultCards(BEN, 1);
    await expect(createOffer(db, SHOP, ANN, { give: [a1], get: [b1] })).rejects.toThrow(/isn't open to trade/);
    await setOpenToTrade(db, SHOP, BEN, b1, true);
    await expect(createOffer(db, SHOP, ANN, { give: [fresh], get: [b1] })).rejects.toThrow(/Tradable In 11 Days/);
    await expect(createOffer(db, SHOP, ANN, { give: [a1], get: [b1], note: "text me 555-1234" })).rejects.toThrow(/note from the list/);
    expect((await myMarketCards(db, SHOP, ANN)).find((c) => c.pullId === fresh)?.locked).toBe("Tradable In 11 Days");
  });

  it("locks offered cards and cancels the other offers once a card moves", async () => {
    const [a1, a2] = await vaultCards(ANN, 2);
    const [b1] = await vaultCards(BEN, 1);
    await setTradeName(db, SHOP, CAL, "Cal");
    const [c1] = await vaultCards(CAL, 1);
    await setOpenToTrade(db, SHOP, BEN, b1, true);
    const fromAnn = await createOffer(db, SHOP, ANN, { give: [a1], get: [b1] });
    await expect(createOffer(db, SHOP, ANN, { give: [a1], get: [b1] })).rejects.toThrow(/already in another offer/);
    const fromCal = await createOffer(db, SHOP, CAL, { give: [c1], get: [b1] });

    await respondToOffer(db, SHOP, BEN, fromCal.id, "accept");
    expect((await db.trade.findUniqueOrThrow({ where: { id: fromAnn.id } })).status).toBe("CANCELLED");
    await expect(respondToOffer(db, SHOP, BEN, fromAnn.id, "accept")).rejects.toThrow(/no longer open/);
    // a1 is free again for a new offer.
    await setOpenToTrade(db, SHOP, CAL, b1, true);
    await createOffer(db, SHOP, ANN, { give: [a1, a2], get: [b1] });
  });

  it("counters, cancels, expires and staff can reverse", async () => {
    const [a1, a2] = await vaultCards(ANN, 2);
    const [b1] = await vaultCards(BEN, 1);
    await setOpenToTrade(db, SHOP, BEN, b1, true);
    const first = await createOffer(db, SHOP, ANN, { give: [a1], get: [b1] });
    // Ben asks for a2 as well, giving b1: a counter can ask for cards that weren't open to trade.
    await expect(createOffer(db, SHOP, BEN, { give: [b1], get: [a1, a2] })).rejects.toThrow(/isn't open to trade/);
    await setOpenToTrade(db, SHOP, ANN, a2, true);
    const counter = await createOffer(db, SHOP, BEN, { give: [b1], get: [a1, a2], counterOfId: first.id });
    expect((await db.trade.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("DECLINED");
    await respondToOffer(db, SHOP, ANN, counter.id, "accept");
    expect([await owner(a1), await owner(a2), await owner(b1)]).toEqual([BEN, BEN, ANN]);

    await reverseTrade(db, SHOP, counter.id);
    expect([await owner(a1), await owner(a2), await owner(b1)]).toEqual([ANN, ANN, BEN]);

    await setOpenToTrade(db, SHOP, BEN, b1, true);
    const lapsing = await createOffer(db, SHOP, ANN, { give: [a1], get: [b1] });
    await cancelOffer(db, SHOP, ANN, lapsing.id);
    const later = await createOffer(db, SHOP, ANN, { give: [a1], get: [b1] });
    await expireOffers(db, new Date(Date.now() + 8 * 86_400_000));
    expect((await db.trade.findUniqueOrThrow({ where: { id: later.id } })).status).toBe("EXPIRED");
  });

  it("does nothing while the marketplace is off", async () => {
    const [b1] = await vaultCards(BEN, 1);
    await updateMarketSettings(db, SHOP, { enabled: false });
    await expect(setOpenToTrade(db, SHOP, BEN, b1, true)).rejects.toThrow(/isn't open yet/);
  });

  it("a refund on the original pack order flags a traded card instead of taking it back", async () => {
    const [a1] = await vaultCards(ANN, 1);
    const [b1] = await vaultCards(BEN, 1);
    await setOpenToTrade(db, SHOP, BEN, b1, true);
    const offer = await createOffer(db, SHOP, ANN, { give: [a1], get: [b1] });
    await respondToOffer(db, SHOP, BEN, offer.id, "accept");
    const annOrder = (await db.pull.findUniqueOrThrow({ where: { id: a1 } })).orderId;

    const voided = await voidPulls(db, annOrder);
    expect(voided).toHaveLength(0);
    const card = await db.pull.findUniqueOrThrow({ where: { id: a1 } });
    expect(card.status).toBe("REVEALED");
    expect(card.customerId).toBe(BEN);
    expect(card.refundFlaggedAt).not.toBeNull();
  });

  it("the original order link no longer shows a card that was traded away", async () => {
    const [a1] = await vaultCards(ANN, 1);
    const [b1] = await vaultCards(BEN, 1);
    const token = (await db.packOrder.findFirstOrThrow({ where: { customerId: ANN } })).openToken;
    await setOpenToTrade(db, SHOP, BEN, b1, true);
    const offer = await createOffer(db, SHOP, ANN, { give: [a1], get: [b1] });
    await respondToOffer(db, SHOP, BEN, offer.id, "accept");
    expect((await pullsForViewer(db, SHOP, { openToken: token })).map((p) => p.id)).toEqual([]);
  });

  it("moving a vault keeps a traded-in card's original order with its buyer", async () => {
    const [a1] = await vaultCards(ANN, 1);
    const [b1] = await vaultCards(BEN, 1);
    await setOpenToTrade(db, SHOP, BEN, b1, true);
    const offer = await createOffer(db, SHOP, ANN, { give: [a1], get: [b1] });
    await respondToOffer(db, SHOP, BEN, offer.id, "accept");
    await moveVault(db, SHOP, ANN, CAL);
    expect(await owner(b1)).toBe(CAL);
    const benOrder = (await db.pull.findUniqueOrThrow({ where: { id: b1 } })).orderId;
    expect((await db.packOrder.findUniqueOrThrow({ where: { orderId: benOrder } })).customerId).toBe(BEN);
  });
});

describe("selling", () => {
  it("lists, checks out, moves the card on payment and pays the seller after the hold", async () => {
    const [b1] = await vaultCards(BEN, 1);
    const listing = await createListing(db, SHOP, BEN, b1, 20);
    expect((await boardCards(db, SHOP, ANN))[0].listing).toMatchObject({ price: 20 });

    const { admin, calls, pay } = fakeAdmin();
    await expect(startPurchase(db, admin, SHOP, BEN, listing.id)).rejects.toThrow(/your own card/);
    const { invoiceUrl } = await startPurchase(db, admin, SHOP, ANN, listing.id);
    expect(invoiceUrl).toBe("https://pay/1");
    const draft = calls.find((c) => c.query.includes("draftOrderCreate"))!.variables.input as {
      lineItems: { requiresShipping: boolean; originalUnitPriceWithCurrency: { amount: string } }[];
      customAttributes: { key: string; value: string }[];
    };
    expect(draft.lineItems[0]).toMatchObject({ requiresShipping: false, originalUnitPriceWithCurrency: { amount: "20.00" } });
    expect(draft.customAttributes[0].value).toBe(listing.id);
    // Same buyer again gets the same invoice; another buyer is turned away; the seller can't ship it.
    expect((await startPurchase(db, admin, SHOP, ANN, listing.id)).invoiceUrl).toBe("https://pay/1");
    await expect(requestShipment(db, admin, SHOP, { customerId: BEN })).rejects.toThrow(/no cards in your vault/);

    await completeSale(db, listing.id, "gid://shopify/Order/900", "#900");
    expect(await owner(b1)).toBe(ANN);
    const sold = await db.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(sold).toMatchObject({ status: "SOLD", payoutStatus: "HELD" });
    expect(Number(sold.payoutAmount)).toBe(18);
    // A retried webhook does nothing.
    expect(await completeSale(db, listing.id, "gid://shopify/Order/900", "#900")).toBeNull();

    expect(await payOutSellers(db, async () => admin)).toBe(0);
    expect(await payOutSellers(db, async () => admin, new Date(Date.now() + 15 * 86_400_000))).toBe(1);
    // Paid in Vault Credit (this app's ledger), never Shopify store credit.
    expect(calls.some((c) => c.query.includes("storeCreditAccountCredit"))).toBe(false);
    expect(await creditBalance(db, SHOP, BEN)).toBe(18);
    expect((await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).payoutStatus).toBe("PAID");
    void pay;
  });

  it("an unpaid invoice lapses and the card goes back on the board", async () => {
    const [b1] = await vaultCards(BEN, 1);
    const listing = await createListing(db, SHOP, BEN, b1, 5);
    const { admin } = fakeAdmin();
    await startPurchase(db, admin, SHOP, ANN, listing.id);
    await expireCheckouts(db, async () => admin, new Date(Date.now() + 2 * 3_600_000));
    expect((await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe("ACTIVE");
    expect(await owner(b1)).toBe(BEN);
  });

  it("a refunded purchase holds the seller's credit and staff can send the card back", async () => {
    const [b1] = await vaultCards(BEN, 1);
    const listing = await createListing(db, SHOP, BEN, b1, 10);
    const { admin } = fakeAdmin();
    await startPurchase(db, admin, SHOP, ANN, listing.id);
    await completeSale(db, listing.id, "gid://shopify/Order/901", "#901");
    await flagMarketOrder(db, "gid://shopify/Order/901", "The buyer was refunded.");
    expect(await payOutSellers(db, async () => admin, new Date(Date.now() + 30 * 86_400_000))).toBe(0);
    await reverseSale(db, SHOP, listing.id);
    expect(await owner(b1)).toBe(BEN);
    expect((await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).payoutStatus).toBe("CANCELLED");
  });

  it("selling has its own switch, and shipping a card withdraws its listing", async () => {
    const [b1] = await vaultCards(BEN, 1);
    await updateMarketSettings(db, SHOP, { sellingEnabled: false });
    await expect(createListing(db, SHOP, BEN, b1, 10)).rejects.toThrow(/Selling isn't open/);
    await updateMarketSettings(db, SHOP, { sellingEnabled: true });
    const listing = await createListing(db, SHOP, BEN, b1, 10);
    const { admin } = fakeAdmin();
    await requestShipment(db, admin, SHOP, { customerId: BEN });
    expect((await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe("CANCELLED");
  });
});

describe("staff preview", () => {
  it("builds sample data from series cards without touching any vault, even while off", async () => {
    await vaultCards(BEN, 1);
    await db.card.updateMany({ data: { imageUrl: "https://cdn/card.png" } });
    await updateMarketSettings(db, SHOP, { enabled: false });
    const demo = (await marketDemo(db, SHOP)) as { cards: unknown[]; board: unknown[]; offers: unknown[] };
    expect(demo.cards.length).toBeGreaterThan(0);
    expect(demo.board.length).toBeGreaterThan(0);
    expect(demo.offers).toHaveLength(2);
    expect(JSON.stringify(demo)).not.toMatch(/gid:\/\/shopify\/Customer|marketValue/);
    expect(await db.trade.count()).toBe(0);
  });
});

describe("collections", () => {
  it("shows only cards put up unless the player shares their whole binder", async () => {
    const [b1, b2, b3] = await vaultCards(BEN, 3);
    await setOpenToTrade(db, SHOP, BEN, b1, true);
    await createListing(db, SHOP, BEN, b2, 9);

    const limited = await collectionFor(db, SHOP, "ben", ANN);
    expect(limited.shared).toBe(false);
    expect(limited.cards.map((c) => c.pullId).sort()).toEqual([b1, b2].sort());
    expect(JSON.stringify(limited)).not.toMatch(/marketValue|gid:\/\/shopify\/Customer/);

    await setCollectionSettings(db, SHOP, BEN, { showCollection: true, showcase: [b3] });
    const full = await collectionFor(db, SHOP, "Ben", ANN);
    expect(full.cards).toHaveLength(3);
    expect(full.showcase.map((c) => c.pullId)).toEqual([b3]);
    expect(full.stats).toMatchObject({ cards: 3, forTrade: 1, forSale: 1 });

    // The owner always sees everything; a showcase must be their own cards.
    const [a1] = await vaultCards(ANN, 1);
    await expect(setCollectionSettings(db, SHOP, BEN, { showcase: [a1] })).rejects.toThrow(/your own vault/);
    await expect(collectionFor(db, SHOP, "nobody", ANN)).rejects.toThrow(/No collector/);
  });

  it("lists collectors with something to see, with completed trades", async () => {
    const [a1] = await vaultCards(ANN, 1);
    const [b1] = await vaultCards(BEN, 1);
    await setOpenToTrade(db, SHOP, BEN, b1, true);
    expect((await collectors(db, SHOP, ANN)).map((c) => c.name)).toEqual(["Ben"]);
    const offer = await createOffer(db, SHOP, ANN, { give: [a1], get: [b1] });
    await respondToOffer(db, SHOP, BEN, offer.id, "accept");
    // Ben now holds a1 but it isn't up and his binder isn't shared, so he drops off the list.
    expect(await collectors(db, SHOP, ANN)).toEqual([]);
    await setCollectionSettings(db, SHOP, BEN, { showCollection: true });
    expect((await collectors(db, SHOP, ANN))[0]).toMatchObject({ name: "Ben", trades: 1, cards: 1, shared: true });
  });
});

describe("wishlist and matches", () => {
  const variantOf = async (pullId: string) =>
    (await db.pull.findUniqueOrThrow({ where: { id: pullId }, include: { slot: { include: { card: true } } } })).slot.card.variantId;

  it("finds cards in the catalog, counts wanters, and builds perfect matches", async () => {
    const [a1] = await vaultCards(ANN, 1);
    const [b1] = await vaultCards(BEN, 1);
    await setOpenToTrade(db, SHOP, BEN, b1, true);
    await setOpenToTrade(db, SHOP, ANN, a1, true);
    expect((await catalog(db, SHOP, "card 1")).length).toBeGreaterThan(0);

    await addWish(db, SHOP, ANN, await variantOf(b1));
    expect((await boardCards(db, SHOP, CAL)).find((c) => c.pullId === b1)?.wantedBy).toBe(1);
    expect((await wishlist(db, SHOP, ANN))[0].available).toBe(1);

    let matches = await tradeMatches(db, SHOP, ANN);
    expect(matches[0]).toMatchObject({ trader: "Ben", perfect: false });
    await addWish(db, SHOP, BEN, await variantOf(a1));
    matches = await tradeMatches(db, SHOP, ANN);
    expect(matches[0].perfect).toBe(true);
    expect(matches[0].theyWant.map((c) => c.pullId)).toEqual([a1]);

    await removeWish(db, SHOP, ANN, await variantOf(b1));
    expect(await wishlist(db, SHOP, ANN)).toEqual([]);
  });

  it("alerts each wisher once per copy, never the owner", async () => {
    const [b1] = await vaultCards(BEN, 1);
    await addWish(db, SHOP, ANN, await variantOf(b1));
    await setOpenToTrade(db, SHOP, BEN, b1, true);
    expect(await sendWishlistAlerts(db, undefined, SHOP, b1)).toBe(1);
    expect(await sendWishlistAlerts(db, undefined, SHOP, b1)).toBe(0);
  });

  it("feed shows trades and listings without prices", async () => {
    const [a1] = await vaultCards(ANN, 1);
    const [b1, b2] = await vaultCards(BEN, 2);
    await setOpenToTrade(db, SHOP, BEN, b1, true);
    await createListing(db, SHOP, BEN, b2, 30);
    const offer = await createOffer(db, SHOP, ANN, { give: [a1], get: [b1] });
    await respondToOffer(db, SHOP, BEN, offer.id, "accept");
    const feed = await activityFeed(db, SHOP);
    expect(feed.map((e) => e.type).sort()).toEqual(["listed", "trade"]);
    expect(JSON.stringify(feed)).not.toMatch(/price|30\.00|"30"/);
  });
});

describe("vault credit", () => {
  it("buys a listed card with Vault Credit and pays the seller right away", async () => {
    const [b1] = await vaultCards(BEN, 1);
    const listing = await createListing(db, SHOP, BEN, b1, 20);
    await expect(buyWithCredit(db, SHOP, ANN, listing.id)).rejects.toThrow(/enough Vault Credit/);
    await adjustCredit(db, SHOP, ANN, 25, "Test top-up");
    await buyWithCredit(db, SHOP, ANN, listing.id);
    expect(await owner(b1)).toBe(ANN);
    expect(await creditBalance(db, SHOP, ANN)).toBe(5);
    expect(await creditBalance(db, SHOP, BEN)).toBe(18);
    await setTradeName(db, SHOP, CAL, "Cal");
    await expect(buyWithCredit(db, SHOP, CAL, listing.id)).rejects.toThrow(/isn't for sale/);
  });

  it("makes collection-limited codes, returns leftovers, and refunds cancelled orders", async () => {
    const { admin, calls } = fakeAdmin();
    await adjustCredit(db, SHOP, ANN, 30, "Test top-up");
    await expect(createCreditCode(db, admin, SHOP, ANN, 10)).rejects.toThrow(/aren't available/);
    await updateMarketSettings(db, SHOP, { creditCollectionIds: ["gid://shopify/Collection/9"] });
    await expect(createCreditCode(db, admin, SHOP, ANN, 40)).rejects.toThrow(/enough Vault Credit/);

    const code = await createCreditCode(db, admin, SHOP, ANN, 20);
    expect(await creditBalance(db, SHOP, ANN)).toBe(10);
    const input = calls.find((c) => c.query.includes("discountCodeBasicCreate"))!.variables.input as Record<string, unknown>;
    expect(input).toMatchObject({
      code: code.code,
      usageLimit: 1,
      context: { customers: { add: [ANN] } },
      customerGets: { value: { discountAmount: { amount: "20.00" } }, items: { collections: { add: ["gid://shopify/Collection/9"] } } },
    });

    // The cart only had $12.50 of eligible items: $7.50 comes back.
    await settleCreditCodes(db, { admin_graphql_api_id: "gid://shopify/Order/77", name: "#77", discount_codes: [{ code: code.code, amount: "12.50" }] });
    expect(await creditBalance(db, SHOP, ANN)).toBe(17.5);
    await settleCreditCodes(db, { admin_graphql_api_id: "gid://shopify/Order/77", name: "#77", discount_codes: [{ code: code.code, amount: "12.50" }] });
    expect(await creditBalance(db, SHOP, ANN)).toBe(17.5);
    await refundCreditCodes(db, "gid://shopify/Order/77");
    expect(await creditBalance(db, SHOP, ANN)).toBe(30);

    const unused = await createCreditCode(db, admin, SHOP, ANN, 5);
    await returnCreditCode(db, admin, SHOP, ANN, unused.id);
    expect(await creditBalance(db, SHOP, ANN)).toBe(30);
    const lapsing = await createCreditCode(db, admin, SHOP, ANN, 5);
    await expireCreditCodes(db, async () => admin, new Date(Date.now() + 31 * 86_400_000));
    expect((await db.creditCode.findUniqueOrThrow({ where: { id: lapsing.id } })).status).toBe("EXPIRED");
    expect(await creditBalance(db, SHOP, ANN)).toBe(30);
  });
});

describe("soft launch", () => {
  it("limits Vault Market to tagged customers when an access tag is set", async () => {
    const admin = { graphql: async () => new Response(JSON.stringify({ data: { customer: { tags: ["VIP", "Vault-Beta"] } } })) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = admin as any;
    expect(await hasMarketAccess(db, a, SHOP, ANN)).toBe(true);
    await updateMarketSettings(db, SHOP, { accessTag: "vault-beta" });
    expect(await hasMarketAccess(db, a, SHOP, ANN)).toBe(true);
    await updateMarketSettings(db, SHOP, { accessTag: "staff-only" });
    expect(await hasMarketAccess(db, a, SHOP, ANN)).toBe(false);
    expect(await hasMarketAccess(db, a, SHOP, null)).toBe(false);
  });
});
