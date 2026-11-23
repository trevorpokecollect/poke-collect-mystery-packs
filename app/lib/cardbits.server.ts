import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { reviewWorkspaceEnabled as deskEnabled, readBook, lockBook } from "../workspace/book.server";
import {offer as currentOffer} from "../workspace/model";
import { isCardbit } from "./cardbit.server";
import { drawForOrderInTransaction, PoolError } from "./pool.server";
import { gql } from "./orders.server";

type Tx = Prisma.TransactionClient;
type Config = {
  customers: string[];
  gateway: string;
  variants: Record<string, number>;
  series: Record<string, number>;
};
const HOUSE = "cardbit:test:merchant";
const digest = (parts: unknown[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const positive = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= 10_000_000;
const pairs = (input: string | undefined): Record<string, number> => {
  const value = JSON.parse(input || "{}");
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Object.values(value).every(positive)
  )
    throw new Error("The Cardbits staging catalog is invalid.");
  return value;
};
export function cardbitsConfig(shop: string, env = process.env): Config | null {
  if (!isCardbit(shop, env) || env.CARDBIT_COMMERCE_MODE !== "staging")
    return null;
  const customers = (env.CARDBIT_QA_CUSTOMERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    customers,
    gateway: env.CARDBIT_TEST_GATEWAY || "",
    variants: pairs(env.CARDBIT_TEST_TOPUPS),
    series: pairs(env.CARDBIT_TEST_SERIES),
  };
}
async function lock(tx: Tx, shop: string, customerId: string) {
  await tx.cardbitWallet.upsert({
    where: { shop_customerId: { shop, customerId } },
    create: { shop, customerId },
    update: {},
  });
  await tx.$queryRaw`SELECT "customerId" FROM "CardbitWallet" WHERE shop=${shop} AND "customerId"=${customerId} FOR UPDATE`;
  return tx.cardbitWallet.findUniqueOrThrow({
    where: { shop_customerId: { shop, customerId } },
  });
}
export async function walletView(
  db: PrismaClient,
  shop: string,
  customerId?: string,
) {
  const config = cardbitsConfig(shop);
  if (!customerId || !config?.customers.includes(customerId))
    return { enabled: false };
  const [wallet, series, offers, history] = await Promise.all([
    db.cardbitWallet.findUnique({
      where: { shop_customerId: { shop, customerId } },
    }),
    db.series.findMany({
      where: {
        shop,
        staffTest: true,
        status: "LIVE",
        OR: [{handle:{in:Object.keys(config.series)}},...(deskEnabled(shop)?[{handle:{startsWith:"cb-workspace-"},packVariantId:{startsWith:"qa:cb-workspace-"}}]:[])],
      },
      select: {
        id: true,
        title: true,
        handle: true,
        commitHash: true,
        cardsPerPack: true,
        packPrice: true,
      },
    }),
    db.cardbitBuyback.findMany({
      where: {
        shop,
        customerId,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { copyId: true, amount: true, expiresAt: true },
    }),
    db.cardbitReceipt.findMany({
      where: { shop, customerId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { kind: true, delta: true, openingId: true, createdAt: true },
    }),
  ]);
  let dynamic: {copyId:string;amount:number;version:string}[]|undefined;
  if(deskEnabled(shop)){
    const [book,pulls]=await Promise.all([readBook(db),db.pull.findMany({where:{shop,customerId,status:"REVEALED",shipRequestId:null,series:{staffTest:true},listings:{none:{status:{in:["ACTIVE","CHECKOUT"]}}},tradeItems:{none:{trade:{status:"PENDING"}}}},select:{id:true,slot:{select:{card:{select:{variantId:true}}}}}})]);
    dynamic=pulls.flatMap(p=>{const ref=book.refs[book.variants[p.slot.card.variantId]], amount=ref?currentOffer(ref,book.policy):null;
      return amount?[{copyId:p.id,amount,version:"price:"+amount}]:[];});
  }
  return {
    enabled: true,
    mode: "staging",
    accountRef: digest([shop, customerId]),
    balance: wallet?.balance ?? 0,
    held: !!wallet?.held,
    packs: series.map((s) => ({ ...s, price: config.series[s.handle] ?? Math.round(Number(s.packPrice)*100) })),
    offers:dynamic??offers,
    history,
    topups: Object.entries(config.variants)
      .filter(([id]) => /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(id))
      .map(([id, amount]) => ({ amount, variant: id.split("/").pop() })),
  };
}

export type VerifiedFunding = {
  id: string;
  customerId: string;
  amount: number;
};
type Money = { amount: string; currencyCode: string };
type PaymentOrder = {
  id: string;
  test: boolean;
  cancelledAt: string | null;
  displayFinancialStatus: string;
  customer: { id: string } | null;
  totalPriceSet: { shopMoney: Money };
  lineItems: {
    nodes: { quantity: number; variant: { id: string } | null }[];
    pageInfo: { hasNextPage: boolean };
  };
  transactions: {
    test: boolean;
    status: string;
    kind: string;
    gateway: string;
    amountSet: { shopMoney: Money };
  }[];
};
function cents(money: Money): number {
  if (money.currencyCode !== "USD" || !/^\d+(\.\d{1,2})?$/.test(money.amount))
    return -1;
  const [whole, fraction = ""] = money.amount.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function verifiedFunding(
  order: PaymentOrder | null,
  config: Config,
): VerifiedFunding | null {
  if (
    !order?.test ||
    order.cancelledAt ||
    order.displayFinancialStatus !== "PAID" ||
    !order.customer ||
    !config.customers.includes(order.customer.id) ||
    !config.gateway ||
    order.transactions.length >= 100 ||
    order.lineItems.pageInfo.hasNextPage
  )
    return null;
  let amount = 0;
  for (const line of order.lineItems.nodes) {
    const rate = line.variant && config.variants[line.variant.id];
    if (!positive(rate) || !positive(line.quantity)) return null;
    amount += rate * line.quantity;
  }
  const captures = order.transactions.filter(
    (t) => t.status === "SUCCESS" && ["CAPTURE", "SALE"].includes(t.kind),
  );
  if (
    !positive(amount) ||
    cents(order.totalPriceSet.shopMoney) !== amount ||
    !captures.length ||
    captures.some(
      (t) =>
        !t.test ||
        t.gateway !== config.gateway ||
        cents(t.amountSet.shopMoney) < 0,
    ) ||
    captures.reduce((sum, t) => sum + cents(t.amountSet.shopMoney), 0) !==
      amount
  )
    return null;
  return { id: order.id, customerId: order.customer.id, amount };
}
export async function recordFunding(
  db: PrismaClient,
  shop: string,
  order: VerifiedFunding,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${shop + "/" + order.id},0))::text`;
    await lock(tx, shop, order.customerId);
    const key = "fund:" + order.id;
    const old = await tx.cardbitReceipt.findUnique({
      where: { shop_eventKey: { shop, eventKey: key } },
    });
    if (old) return old;
    const reversal = await tx.cardbitReceipt.findUnique({
      where: { shop_eventKey: { shop, eventKey: "review:" + order.id } },
    });
    if (reversal) return reversal;
    await tx.cardbitWallet.update({
      where: { shop_customerId: { shop, customerId: order.customerId } },
      data: { balance: { increment: order.amount } },
    });
    return tx.cardbitReceipt.create({
      data: {
        shop,
        customerId: order.customerId,
        eventKey: key,
        fingerprint: digest([order.id, order.amount]),
        kind: "topup",
        delta: order.amount,
      },
    });
  });
}
export async function fundTestOrder(
  db: PrismaClient,
  admin: AdminApiContext,
  shop: string,
  id: string,
) {
  const config = cardbitsConfig(shop);
  if (!config) return;
  const data = await gql(
    admin,
    `#graphql
    query CardbitFunding($id: ID!) { order(id: $id) { id test cancelledAt displayFinancialStatus customer { id }
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first:100) {nodes {quantity variant{id}} pageInfo{hasNextPage}}
      transactions(first:100) {test status kind gateway amountSet {shopMoney {amount currencyCode}}}
    }}`,
    { id },
  );
  const funding = verifiedFunding(data.order, config);
  if (funding) await recordFunding(db, shop, funding);
}
export async function reviewFunding(
  db: PrismaClient,
  shop: string,
  orderId: string,
) {
  if (!cardbitsConfig(shop)) return;
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${shop + "/" + orderId},0))::text`;
    const receipt = await tx.cardbitReceipt.findUnique({
      where: { shop_eventKey: { shop, eventKey: "fund:" + orderId } },
    });
    const customerId = receipt?.customerId ?? HOUSE;
    if (receipt) {
      await lock(tx, shop, customerId);
      await tx.cardbitWallet.update({
        where: { shop_customerId: { shop, customerId } },
        data: { held: true },
      });
    }
    await tx.cardbitReceipt.upsert({
      where: { shop_eventKey: { shop, eventKey: "review:" + orderId } },
      create: {
        shop,
        customerId,
        eventKey: "review:" + orderId,
        fingerprint: digest([orderId]),
        kind: "funding-review",
        delta: 0,
      },
      update: {},
    });
  });
}

export type CardbitAction = {
  action: "pack" | "buyback";
  id: string;
  requestId: string;
  amount: number;
  version: string;
};
export async function walletAction(
  db: PrismaClient,
  shop: string,
  customerId: string,
  input: CardbitAction,
) {
  const config = cardbitsConfig(shop);
  if (!config?.customers.includes(customerId))
    throw new PoolError("Cardbits testing is unavailable for this account.");
  if (
    !["pack", "buyback"].includes(input.action) ||
    typeof input.id !== "string" ||
    !input.id ||
    input.id.length > 128 ||
    !positive(input.amount) ||
    typeof input.version !== "string" ||
    input.version.length > 128 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.requestId,
    )
  )
    throw new PoolError("Review the offer again.");
  return db.$transaction(async (tx) => {
    const wallet = await lock(tx, shop, customerId);
    const eventKey = customerId + "/" + input.requestId,
      fingerprint = digest([
        input.action,
        input.id,
        input.amount,
        input.version,
      ]);
    const previous = await tx.cardbitReceipt.findUnique({
      where: { shop_eventKey: { shop, eventKey } },
    });
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new PoolError(
          "This confirmation already belongs to another action.",
        );
      return previous;
    }
    if (wallet.held)
      throw new PoolError("Cardbits activity is paused for payment review.");
    let openingId: string | null = null,
      copyId: string | null = null;
    const delta = input.action === "pack" ? -input.amount : input.amount;
    if (input.action === "pack") {
      const series = await tx.series.findFirst({
        where: { id: input.id, shop, staffTest: true, status: "LIVE" },
      });
      if (
        !series ||
        (config.series[series.handle] ?? (deskEnabled(shop) && series.handle.startsWith("cb-workspace-") && series.packVariantId==="qa:"+series.handle ? Math.round(Number(series.packPrice)*100):null)) !== input.amount ||
        series.commitHash !== input.version
      )
        throw new PoolError(
          "The pack price or series changed. Review it again.",
        );
      if (wallet.balance < input.amount)
        throw new PoolError("Your Cardbits balance is too low.");
      const orderId = "cardbit-test:" + randomUUID();
      const draw = await drawForOrderInTransaction(
        tx,
        {
          shop,
          orderId,
          orderName: series.title,
          customerId,
          lines: [
            {
              lineItemId: orderId + "/1",
              quantity: 1,
              variantId: series.packVariantId,
            },
          ],
        },
        series.id,
      );
      if (draw.shortfall.length || draw.pulls.length !== series.cardsPerPack)
        throw new PoolError("This edition is sold out.");
      openingId = draw.pulls[0].id;
      // The test receipt is the order record. Recovery workers must not send it to Shopify fulfillment.
      const now = new Date();
      await tx.packOrder.update({
        where: { orderId },
        data: {
          held: true,
          finalized: true,
          packLinesFulfilledAt: now,
          pullsNotedAt: now,
        },
      });
    } else {
      const dynamic=deskEnabled(shop);
      if(dynamic){
        await lockBook(tx);
        const book=await readBook(tx);
        const p=await tx.pull.findFirst({where:{id:input.id,shop,customerId,status:"REVEALED",shipRequestId:null,series:{staffTest:true}},
          select:{slot:{select:{card:{select:{variantId:true}}}}}});
        const ref=p&&book.refs[book.variants[p.slot.card.variantId]];
        if(!ref||currentOffer(ref,book.policy)!==input.amount||input.version!=="price:"+input.amount) throw new PoolError("The Cardbits offer changed. Review the current value.");
      }
      const offer = dynamic?null:await tx.cardbitBuyback.findFirst({
        where: {
          copyId: input.id,
          shop,
          customerId,
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (
        !dynamic && (!offer ||
        offer.amount !== input.amount ||
        offer.expiresAt.toISOString() !== input.version)
      )
        throw new PoolError("This buyback offer changed or expired.");
      const acquired = await tx.pull.updateMany({
        where: {
          id: input.id,
          shop,
          customerId,
          status: "REVEALED",
          shipRequestId: null,
          series: { staffTest: true },
          ...(dynamic ? {listings:{none:{status:{in:["ACTIVE" as const,"CHECKOUT" as const]}}},tradeItems:{none:{trade:{status:"PENDING" as const}}}} : {}),
        },
        data: { customerId: HOUSE, transferredAt: new Date() },
      });
      if (acquired.count !== 1)
        throw new PoolError("This copy is no longer available for buyback.");
      if(!dynamic) await tx.cardbitBuyback.update({
        where: { copyId: input.id },
        data: { acceptedAt: new Date() },
      });
      await tx.pullTransfer.create({
        data: {
          shop,
          pullId: input.id,
          fromCustomerId: customerId,
          toCustomerId: HOUSE,
          reason: "CARDBIT_TEST_BUYBACK",
        },
      });
      copyId = input.id;
    }
    await tx.cardbitWallet.update({
      where: { shop_customerId: { shop, customerId } },
      data: { balance: { increment: delta } },
    });
    return tx.cardbitReceipt.create({
      data: {
        shop,
        customerId,
        eventKey,
        fingerprint,
        kind: input.action,
        delta,
        openingId,
        copyId,
      },
    });
  });
}
