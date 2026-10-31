// Runs against a real Postgres (TEST_DATABASE_URL), like the pool tests.
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drawForOrder, launchSeries, pullsForViewer, revealPull, voidPulls } from "./pool.server";
import {
  acceptTerms,
  requireTerms,
  activityFeed,
  addWish,
  boardCards,
  buyWithCredit,
  catalog,
  collectionFor,
  collectors,
  cancelListing,
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
import { cancelShipment, moveVault, requestShipment, vaultedPulls } from "./vault.server";
import { choseVaultRate, vaultSinglesFromOrder } from "./vault-singles.server";
import { adjustCredit, createCreditCode, creditBalance, expireCreditCodes, refundCreditCodeLines, refundCreditCodes, returnCreditCode, settleCreditCodes } from "./credit.server";

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

describe("terms", () => {
  it("needs the current terms agreed to, and a trade name first", async () => {
    await expect(requireTerms(db, SHOP, ANN)).rejects.toThrow(/agree to the Vault Market Terms/);
    await expect(acceptTerms(db, SHOP, "gid://shopify/Customer/nobody")).rejects.toThrow(/trade name/);
    await acceptTerms(db, SHOP, ANN);
    await expect(requireTerms(db, SHOP, ANN)).resolves.toBeUndefined();
  });
});

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

  it("trades fresh pulls right away (no hold), but not cards that aren't open to trade or free-text notes", async () => {
    const [fresh] = await vaultCards(ANN, 1, 0);
    const [b1] = await vaultCards(BEN, 1);
    await expect(createOffer(db, SHOP, ANN, { give: [fresh], get: [b1] })).rejects.toThrow(/isn't open to trade/);
    await setOpenToTrade(db, SHOP, BEN, b1, true);
    await expect(createOffer(db, SHOP, ANN, { give: [fresh], get: [b1], note: "text me 555-1234" })).rejects.toThrow(/note from the list/);
    expect((await myMarketCards(db, SHOP, ANN)).find((c) => c.pullId === fresh)?.locked).toBeNull();
    await createOffer(db, SHOP, ANN, { give: [fresh], get: [b1] });
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

describe("singles bought for the vault", () => {
  it("go to the buyer's vault and ship later as $0 custom lines", async () => {
    expect(choseVaultRate({ shipping_lines: [{ title: "Keep In My Vault (Ships Later)" }] })).toBe(true);
    expect(choseVaultRate({ shipping_lines: [{ title: "Keep In My Vault (Don't Ship Now)" }] })).toBe(true);
    expect(choseVaultRate({ shipping_lines: [{ title: "Standard" }] })).toBe(false);
    const calls: { query: string; variables: Record<string, unknown> }[] = [];
    const admin = {
      graphql: async (query: string, { variables }: { variables: Record<string, unknown> } = { variables: {} }) => {
        calls.push({ query, variables });
        let data: unknown = {};
        if (query.includes("VaultSinglesOrder")) {
          data = {
            order: {
              customer: { id: BEN },
              lineItems: {
                nodes: [
                  { id: "gid://shopify/LineItem/1", quantity: 2, title: "Pikachu", variantTitle: "Near Mint", image: { url: "https://cdn/1.jpg" }, variant: { id: "gid://shopify/ProductVariant/77", displayName: "Pikachu - Near Mint", product: { id: "gid://shopify/Product/7", productType: "Pokemon Single", featuredMedia: null } } },
                  { id: "gid://shopify/LineItem/2", quantity: 1, title: "Sleeves", variantTitle: null, image: null, variant: { id: "gid://shopify/ProductVariant/88", displayName: "Sleeves", product: { id: "gid://shopify/Product/8", productType: "Accessory", featuredMedia: null } } },
                ],
              },
            },
          };
        } else if (query.includes("draftOrderCreate")) data = { draftOrderCreate: { draftOrder: { id: "gid://shopify/DraftOrder/9", invoiceUrl: "https://pay/9" }, userErrors: [] } };
        else if (query.includes("currencyCode")) data = { shop: { currencyCode: "USD" } };
        else if (query.includes("order(id")) data = { order: { shippingAddress: { countryCodeV2: "US" }, fulfillmentOrders: { nodes: [] } } };
        return new Response(JSON.stringify({ data }));
      },
    } as unknown as Parameters<typeof vaultSinglesFromOrder>[1];
    const order = { admin_graphql_api_id: "gid://shopify/Order/500", name: "#500", customer: { admin_graphql_api_id: BEN } };
    expect(await vaultSinglesFromOrder(db, admin, SHOP, order)).toBe(2);
    expect(await vaultSinglesFromOrder(db, admin, SHOP, order)).toBe(0);
    const vault = await vaultedPulls(db, SHOP, { customerId: BEN });
    expect(vault.filter((p) => p.orderId === "gid://shopify/Order/500")).toHaveLength(2);

    await requestShipment(db, admin, SHOP, { customerId: BEN }, { pullIds: vault.map((p) => p.id) });
    const draft = calls.find((c) => c.query.includes("draftOrderCreate"))!.variables.input as { lineItems: { variantId?: string; title?: string; quantity: number }[] };
    expect(draft.lineItems).toEqual([expect.objectContaining({ title: "Vault Card: Pikachu - Near Mint", quantity: 2 })]);
    expect(draft.lineItems.some((l) => l.variantId)).toBe(false);
  });
});

describe("staff test cards", () => {
  it("are hidden on the market except from their owner and testers", async () => {
    const [b1] = await vaultCards(BEN, 1);
    await createListing(db, SHOP, BEN, b1, 20);
    const pull = await db.pull.findUniqueOrThrow({ where: { id: b1 } });
    await db.series.update({ where: { id: pull.seriesId }, data: { staffTest: true } });
    expect(await boardCards(db, SHOP, ANN)).toHaveLength(0);
    expect(await boardCards(db, SHOP, ANN, { tester: true })).toHaveLength(1);
    expect(await myMarketCards(db, SHOP, BEN)).toHaveLength(1);
    await db.series.update({ where: { id: pull.seriesId }, data: { staffTest: false } });
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
    await expect(requestShipment(db, admin, SHOP, { customerId: BEN })).rejects.toThrow(/listed on Vault Market/);

    await completeSale(db, listing.id, "gid://shopify/Order/900", "#900");
    expect(await owner(b1)).toBe(ANN);
    const sold = await db.listing.findUniqueOrThrow({ where: { id: listing.id } });
    // No payout hold: the seller is paid in Vault Credit (this app's ledger) as soon as the buyer pays.
    expect(sold).toMatchObject({ status: "SOLD", payoutStatus: "PAID" });
    expect(Number(sold.payoutAmount)).toBe(18);
    expect(await creditBalance(db, SHOP, BEN)).toBe(18);
    // A retried webhook does nothing, and the payout job has nothing left to pay.
    expect(await completeSale(db, listing.id, "gid://shopify/Order/900", "#900")).toBeNull();
    expect(await payOutSellers(db, async () => admin)).toBe(0);
    expect(await creditBalance(db, SHOP, BEN)).toBe(18);
    expect(calls.some((c) => c.query.includes("storeCreditAccountCredit"))).toBe(false);
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

  it("short on credit: credit comes off the invoice now, the card pays the rest, and a lapse gives it back", async () => {
    const [b1] = await vaultCards(BEN, 1);
    const listing = await createListing(db, SHOP, BEN, b1, 20);
    await adjustCredit(db, SHOP, ANN, 12.5, "Test credit");
    const { admin, calls } = fakeAdmin();
    await startPurchase(db, admin, SHOP, ANN, listing.id, { useCredit: true });
    const draft = calls.find((c) => c.query.includes("draftOrderCreate"))!.variables.input as { appliedDiscount?: { value: number; valueType: string } };
    expect(draft.appliedDiscount).toMatchObject({ value: 12.5, valueType: "FIXED_AMOUNT" });
    // Held off the balance while the invoice is open, so it can't be spent twice.
    expect(await creditBalance(db, SHOP, ANN)).toBe(0);
    expect(Number((await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).creditApplied)).toBe(12.5);
    // Asking again with credit reuses the same invoice and takes nothing more.
    await startPurchase(db, admin, SHOP, ANN, listing.id, { useCredit: true });
    expect(calls.filter((c) => c.query.includes("draftOrderCreate"))).toHaveLength(1);
    expect(await creditBalance(db, SHOP, ANN)).toBe(0);

    await expireCheckouts(db, async () => admin, new Date(Date.now() + 2 * 3_600_000));
    expect((await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe("ACTIVE");
    expect(await creditBalance(db, SHOP, ANN)).toBe(12.5);
    // A second run gives nothing back twice.
    await expireCheckouts(db, async () => admin, new Date(Date.now() + 3 * 3_600_000));
    expect(await creditBalance(db, SHOP, ANN)).toBe(12.5);
  });

  it("credit toward a card checkout leaves at least $0.50 for the card, and the seller still gets the full price", async () => {
    const [b1] = await vaultCards(BEN, 1);
    const listing = await createListing(db, SHOP, BEN, b1, 10);
    await adjustCredit(db, SHOP, ANN, 9.8, "Test credit");
    const { admin, calls } = fakeAdmin();
    await startPurchase(db, admin, SHOP, ANN, listing.id, { useCredit: true });
    const draft = calls.find((c) => c.query.includes("draftOrderCreate"))!.variables.input as { appliedDiscount: { value: number } };
    expect(draft.appliedDiscount.value).toBe(9.5);
    expect(await creditBalance(db, SHOP, ANN)).toBe(0.3);
    await completeSale(db, listing.id, "gid://shopify/Order/910", "#910");
    expect(await owner(b1)).toBe(ANN);
    expect(await creditBalance(db, SHOP, BEN)).toBe(9);
    expect(await creditBalance(db, SHOP, ANN)).toBe(0.3);
    // Reversing gives the buyer's credit part back (staff refund the card part in Shopify).
    await reverseSale(db, SHOP, listing.id);
    expect(await creditBalance(db, SHOP, ANN)).toBe(9.8);
    expect(await creditBalance(db, SHOP, BEN)).toBe(0);
  });

  it("switching between card only and credit + card restarts the checkout without losing credit", async () => {
    const [b1] = await vaultCards(BEN, 1);
    const listing = await createListing(db, SHOP, BEN, b1, 20);
    await adjustCredit(db, SHOP, ANN, 5, "Test credit");
    const { admin, calls } = fakeAdmin();
    await startPurchase(db, admin, SHOP, ANN, listing.id);
    expect(await creditBalance(db, SHOP, ANN)).toBe(5);
    await startPurchase(db, admin, SHOP, ANN, listing.id, { useCredit: true });
    expect(calls.filter((c) => c.query.includes("draftOrderDelete"))).toHaveLength(1);
    expect(await creditBalance(db, SHOP, ANN)).toBe(0);
    await startPurchase(db, admin, SHOP, ANN, listing.id);
    expect(await creditBalance(db, SHOP, ANN)).toBe(5);
    const last = calls.filter((c) => c.query.includes("draftOrderCreate")).at(-1)!.variables.input as { appliedDiscount?: unknown };
    expect(last.appliedDiscount).toBeUndefined();
    expect((await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe("CHECKOUT");
  });

  it("credit goes back if the invoice can't be made", async () => {
    const [b1] = await vaultCards(BEN, 1);
    const listing = await createListing(db, SHOP, BEN, b1, 20);
    await adjustCredit(db, SHOP, ANN, 5, "Test credit");
    const { admin } = fakeAdmin();
    const broken = { graphql: async (q: string, v: unknown) => (q.includes("draftOrderCreate") ? Promise.reject(new Error("Shopify down")) : admin.graphql(q, v)) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(startPurchase(db, broken as any, SHOP, ANN, listing.id, { useCredit: true })).rejects.toThrow(/Shopify down/);
    expect(await creditBalance(db, SHOP, ANN)).toBe(5);
    expect((await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe("ACTIVE");
  });

  it("a refunded purchase is flagged and reversing it takes the seller's credit back, even below zero", async () => {
    const [b1] = await vaultCards(BEN, 1);
    const listing = await createListing(db, SHOP, BEN, b1, 10);
    const { admin } = fakeAdmin();
    await startPurchase(db, admin, SHOP, ANN, listing.id);
    await completeSale(db, listing.id, "gid://shopify/Order/901", "#901");
    expect(await creditBalance(db, SHOP, BEN)).toBe(9);
    // The seller spent the credit before the refund.
    await adjustCredit(db, SHOP, BEN, -9, "Spent elsewhere");
    expect(await flagMarketOrder(db, "gid://shopify/Order/901", "The buyer was refunded.")).toBe(1);
    expect((await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).flagReason).toMatch(/refunded/);
    await reverseSale(db, SHOP, listing.id);
    expect(await owner(b1)).toBe(BEN);
    expect(await creditBalance(db, SHOP, BEN)).toBe(-9);
    expect((await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).payoutStatus).toBe("CANCELLED");
  });

  it("selling has its own switch, and a listed card can't ship until it's taken down", async () => {
    const [b1, b2] = await vaultCards(BEN, 2);
    await updateMarketSettings(db, SHOP, { sellingEnabled: false });
    await expect(createListing(db, SHOP, BEN, b1, 10)).rejects.toThrow(/Selling isn't open/);
    await updateMarketSettings(db, SHOP, { sellingEnabled: true });
    const listing = await createListing(db, SHOP, BEN, b1, 10);
    await setOpenToTrade(db, SHOP, BEN, b2, true);
    const { admin } = fakeAdmin();
    await expect(requestShipment(db, admin, SHOP, { customerId: BEN }, { pullIds: [b1] })).rejects.toThrow(/1 card you picked is listed on Vault Market/);
    await expect(requestShipment(db, admin, SHOP, { customerId: BEN }, { pickup: true, pullIds: [b1, b2] })).rejects.toThrow(/2 cards you picked are listed/);
    await expect(requestShipment(db, admin, SHOP, { customerId: BEN })).rejects.toThrow(/Every card in your vault is listed/);
    expect((await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe("ACTIVE");

    // Taken down from sale and trade, it ships.
    await cancelListing(db, SHOP, BEN, listing.id);
    await setOpenToTrade(db, SHOP, BEN, b2, false);
    await requestShipment(db, admin, SHOP, { customerId: BEN }, { pullIds: [b1, b2] });
    expect(await db.pull.count({ where: { id: { in: [b1, b2] }, shipRequestId: { not: null } } })).toBe(2);

    // Left checkout: Cancel Shipment puts the cards back in the vault.
    await cancelShipment(db, admin, SHOP, { customerId: BEN });
    expect(await db.pull.count({ where: { id: { in: [b1, b2] }, shipRequestId: null } })).toBe(2);
    expect(await db.shipRequest.count({ where: { status: "PENDING" } })).toBe(0);
    await expect(cancelShipment(db, admin, SHOP, { customerId: BEN })).rejects.toThrow(/no open shipment/);
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
    // Refunding 1 of the 2 cards on the code's line gives back half of what the code covered on it;
    // cancelling later gives back only the rest.
    const orderAdmin = {
      graphql: async () =>
        new Response(JSON.stringify({ data: { order: { name: "#77", lineItems: { nodes: [
          { id: "gid://shopify/LineItem/1", quantity: 2, discountAllocations: [{ allocatedAmountSet: { shopMoney: { amount: "12.50" } }, discountApplication: { code: code.code } }] },
        ] } } } })),
    } as unknown as Parameters<typeof refundCreditCodeLines>[1];
    expect(await refundCreditCodeLines(db, orderAdmin, "gid://shopify/Order/77", new Map([["gid://shopify/LineItem/1", 1]]))).toBe(6.25);
    expect(await creditBalance(db, SHOP, ANN)).toBe(23.75);
    await refundCreditCodes(db, "gid://shopify/Order/77");
    expect(await creditBalance(db, SHOP, ANN)).toBe(30);
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
