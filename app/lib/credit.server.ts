// Vault Credit: the marketplace's own balance, kept in this app instead of Shopify store credit.
// Shopify checkout can't see or spend it, so it can never buy Mystery Packs. Players spend it on
// other players' cards inside the app, or turn it into a one-time discount code that only works
// on the eligible collections staff pick (singles, sealed, accessories).
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { Prisma, type PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { gql } from "./orders.server";
import { PoolError } from "./pool.server";

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

/** Unused codes go back to the balance after this long. */
export const CODE_DAYS = 30;
export const MIN_CODE = 1;
const DAY = 86_400_000;

const cents = (n: number) => Math.round(n * 100) / 100;

/** Serializes balance changes per customer, so two spends can't both pass the balance check. */
async function lockCustomer(tx: Tx, shop: string, customerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${shop}:${customerId}`}))`;
}

export async function creditBalance(db: Db | Tx, shop: string, customerId: string) {
  const sum = await db.creditTxn.aggregate({ where: { shop, customerId }, _sum: { amount: true } });
  return cents(Number(sum._sum.amount ?? 0));
}

export async function addCredit(
  tx: Db | Tx,
  row: { shop: string; customerId: string; amount: number; kind: string; listingId?: string; codeId?: string; note?: string },
) {
  return tx.creditTxn.create({ data: { ...row, amount: cents(row.amount) } });
}

/** Takes `amount` off the balance inside a transaction, or refuses if it isn't there. */
export async function spendCredit(
  tx: Tx,
  row: { shop: string; customerId: string; amount: number; kind: string; listingId?: string; codeId?: string; note?: string },
) {
  await lockCustomer(tx, row.shop, row.customerId);
  const balance = await creditBalance(tx, row.shop, row.customerId);
  if (balance + 1e-9 < row.amount) throw new PoolError("You don't have enough Vault Credit for that.");
  return addCredit(tx, { ...row, amount: -row.amount });
}

/** Balance, recent history and open codes for the wallet page. */
export async function creditWallet(db: Db, shop: string, customerId: string) {
  const [balance, history, codes] = await Promise.all([
    creditBalance(db, shop, customerId),
    db.creditTxn.findMany({ where: { shop, customerId }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.creditCode.findMany({ where: { shop, customerId }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return {
    balance,
    history: history.map((h) => ({ id: h.id, amount: Number(h.amount), kind: h.kind, note: h.note, at: h.createdAt })),
    codes: codes.map((c) => ({
      id: c.id,
      code: c.code,
      amount: Number(c.amount),
      status: c.status,
      usedAmount: c.usedAmount === null ? null : Number(c.usedAmount),
      orderName: c.orderName,
      expiresAt: c.expiresAt,
    })),
  };
}

function newCode() {
  // No look-alike characters, so codes are easy to read back.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  return `VAULT-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
}

/**
 * "Use Credit": takes `amount` off the balance and makes a one-time code for it that only this
 * customer can use, only on the eligible collections. Leftovers come back when the order is paid.
 */
export async function createCreditCode(db: Db, admin: AdminApiContext, shop: string, customerId: string, rawAmount: number, now = new Date()) {
  const settings = await db.marketSettings.findUnique({ where: { shop } });
  const collections = settings?.creditCollectionIds ?? [];
  if (!settings?.enabled || collections.length === 0) throw new PoolError("Vault Credit codes aren't available yet.");
  const amount = cents(rawAmount);
  if (!(amount >= MIN_CODE)) throw new PoolError(`Codes start at $${MIN_CODE}.`);
  const expiresAt = new Date(now.getTime() + CODE_DAYS * DAY);

  const code = await db.$transaction(async (tx) => {
    const row = await tx.creditCode.create({ data: { shop, customerId, code: newCode(), amount, expiresAt } });
    await spendCredit(tx, { shop, customerId, amount, kind: "CODE", codeId: row.id, note: row.code });
    return row;
  });

  try {
    const data = await gql(admin, `#graphql
      mutation VaultCreditCode($input: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $input) { codeDiscountNode { id } userErrors { field message } }
      }`, {
      input: {
        title: `Vault Credit ${code.code}`,
        code: code.code,
        startsAt: now.toISOString(),
        endsAt: expiresAt.toISOString(),
        usageLimit: 1,
        appliesOncePerCustomer: true,
        context: { customers: { add: [customerId] } },
        customerGets: {
          value: { discountAmount: { amount: amount.toFixed(2), appliesOnEachItem: false } },
          items: { collections: { add: collections } },
        },
        combinesWith: { productDiscounts: settings.creditCombines, orderDiscounts: settings.creditCombines, shippingDiscounts: true },
      },
    });
    const discountId = data.discountCodeBasicCreate.codeDiscountNode.id as string;
    return db.creditCode.update({ where: { id: code.id }, data: { discountId } });
  } catch (error) {
    // Shopify refused: put the credit back and drop the code.
    await db.$transaction([
      db.creditTxn.deleteMany({ where: { codeId: code.id, kind: "CODE" } }),
      db.creditCode.delete({ where: { id: code.id } }),
    ]);
    throw error;
  }
}

async function codeUses(admin: AdminApiContext, discountId: string) {
  const data = await gql(admin, `#graphql
    query VaultCreditCodeUses($id: ID!) { codeDiscountNode(id: $id) { codeDiscount { ... on DiscountCodeBasic { asyncUsageCount } } } }`, { id: discountId });
  return Number(data.codeDiscountNode?.codeDiscount?.asyncUsageCount ?? 0);
}

async function deleteDiscount(admin: AdminApiContext, discountId: string) {
  await gql(admin, `#graphql
    mutation VaultCreditCodeDelete($id: ID!) { discountCodeDelete(id: $id) { deletedCodeDiscountId userErrors { field message } } }`, { id: discountId });
}

/** "Return To Balance": an unused code is deleted and its full amount goes back. */
export async function returnCreditCode(db: Db, admin: AdminApiContext, shop: string, customerId: string, codeId: string) {
  const code = await db.creditCode.findFirst({ where: { id: codeId, shop, customerId, status: "ACTIVE" } });
  if (!code) throw new PoolError("That code can't be returned.");
  if (code.discountId) {
    if ((await codeUses(admin, code.discountId)) > 0) throw new PoolError("That code was already used. Its leftover comes back once the order goes through.");
    await deleteDiscount(admin, code.discountId);
  }
  return closeCode(db, code.id, "RETURNED", Number(code.amount), "Code returned to balance");
}

async function closeCode(db: Db, codeId: string, status: string, giveBack: number, note: string, extra: Prisma.CreditCodeUpdateInput = {}) {
  return db.$transaction(async (tx) => {
    const { count } = await tx.creditCode.updateMany({ where: { id: codeId, status: "ACTIVE" }, data: { status } });
    if (!count) return null;
    const code = await tx.creditCode.update({ where: { id: codeId }, data: extra });
    if (giveBack > 0.004) await addCredit(tx, { shop: code.shop, customerId: code.customerId, amount: giveBack, kind: "CODE_RETURN", codeId, note });
    return code;
  });
}

export interface OrderDiscountCodes {
  admin_graphql_api_id: string;
  name: string;
  discount_codes?: { code: string; amount: string }[] | null;
}

/**
 * A paid order used Vault Credit codes: record what each code covered and give back the rest
 * (the code is capped by the eligible items in the cart, so a smaller order leaves some unused).
 */
export async function settleCreditCodes(db: Db, order: OrderDiscountCodes) {
  const used = (order.discount_codes ?? []).filter((d) => /^VAULT-/i.test(d.code));
  let settled = 0;
  for (const d of used) {
    const code = await db.creditCode.findUnique({ where: { code: d.code.toUpperCase() } });
    if (!code || code.status !== "ACTIVE") continue;
    const applied = Math.min(Number(code.amount), cents(Number(d.amount) || 0));
    const leftover = cents(Number(code.amount) - applied);
    await closeCode(db, code.id, "USED", leftover, `Unused part of ${code.code} (${order.name})`, {
      orderId: order.admin_graphql_api_id,
      orderName: order.name,
      usedAmount: applied,
    });
    settled++;
  }
  return settled;
}

/** Gives back up to `amount` of what a used code covered, never more than it covered in total. */
async function returnCodeShare(db: Db, codeId: string, amount: number, note: string) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "CreditCode" WHERE id = ${codeId} FOR UPDATE`;
    const code = await tx.creditCode.findUniqueOrThrow({ where: { id: codeId } });
    const left = cents(Number(code.usedAmount ?? 0) - Number(code.refundedAmount));
    const give = cents(Math.min(left, amount));
    if (give <= 0.004) return 0;
    await tx.creditCode.update({
      where: { id: code.id },
      data: { refundedAmount: { increment: give }, ...(give >= left - 0.004 ? { status: "REFUNDED" } : {}) },
    });
    await addCredit(tx, { shop: code.shop, customerId: code.customerId, amount: give, kind: "CODE_RETURN", codeId: code.id, note });
    return give;
  });
}

/** A cancelled order that used a Vault Credit code: what the code covered (and wasn't already refunded) goes back. */
export async function refundCreditCodes(db: Db, orderId: string) {
  const codes = await db.creditCode.findMany({ where: { orderId, status: "USED" } });
  for (const code of codes) await returnCodeShare(db, code.id, Number(code.usedAmount ?? 0), `${code.orderName ?? "Order"} cancelled`);
  return codes.length;
}

/**
 * A refund (without cancelling) on an order paid partly with Vault Credit codes: Shopify can only
 * refund what was paid by card, so each refunded line's share of the code goes back to Vault
 * Credit here. Never to Shopify store credit or the card (legal, 2026-10-23).
 */
export async function refundCreditCodeLines(db: Db, admin: AdminApiContext, orderId: string, refunded: Map<string, number>) {
  const codes = await db.creditCode.findMany({ where: { orderId, status: "USED" } });
  if (codes.length === 0 || refunded.size === 0) return 0;
  const data = await gql(admin, `#graphql
    query VaultCreditRefundLines($id: ID!) {
      order(id: $id) {
        name
        lineItems(first: 100) {
          nodes {
            id quantity
            discountAllocations { allocatedAmountSet { shopMoney { amount } } discountApplication { ... on DiscountCodeApplication { code } } }
          }
        }
      }
    }`, { id: orderId });
  type Line = { id: string; quantity: number; discountAllocations: { allocatedAmountSet: { shopMoney: { amount: string } }; discountApplication: { code?: string } }[] };
  const share = new Map<string, number>();
  for (const line of (data.order?.lineItems?.nodes ?? []) as Line[]) {
    const qty = refunded.get(line.id);
    if (!qty || !line.quantity) continue;
    for (const a of line.discountAllocations) {
      const code = a.discountApplication?.code?.toUpperCase();
      if (!code?.startsWith("VAULT-")) continue;
      share.set(code, (share.get(code) ?? 0) + (Number(a.allocatedAmountSet.shopMoney.amount) * Math.min(qty, line.quantity)) / line.quantity);
    }
  }
  let total = 0;
  for (const code of codes) {
    const amount = share.get(code.code.toUpperCase());
    if (amount) total += await returnCodeShare(db, code.id, amount, `${data.order?.name ?? code.orderName ?? "Order"} refunded`);
  }
  return cents(total);
}

/** Codes past their 30 days: deleted in Shopify, and the full amount goes back to the balance. */
export async function expireCreditCodes(db: Db, adminFor: (shop: string) => Promise<AdminApiContext>, now = new Date()) {
  const due = await db.creditCode.findMany({ where: { status: "ACTIVE", expiresAt: { lt: now } }, take: 100 });
  for (const code of due) {
    try {
      const admin = await adminFor(code.shop);
      // Used but the order webhook hasn't settled it yet: leave it for that.
      if (code.discountId && (await codeUses(admin, code.discountId)) > 0) continue;
      if (code.discountId) await deleteDiscount(admin, code.discountId).catch(() => undefined);
      await closeCode(db, code.id, "EXPIRED", Number(code.amount), `${code.code} expired`);
    } catch (error) {
      console.error(`Expiring credit code ${code.id} failed`, error);
    }
  }
}

/** Staff: add or take away Vault Credit by hand, with a reason. */
export async function adjustCredit(db: Db, shop: string, customerId: string, amount: number, note: string) {
  if (!amount || !note.trim()) throw new PoolError("Enter an amount and a reason.");
  return db.$transaction(async (tx) => {
    if (amount < 0) return spendCredit(tx, { shop, customerId, amount: -amount, kind: "ADJUST", note });
    return addCredit(tx, { shop, customerId, amount, kind: "ADJUST", note });
  });
}

/**
 * Staff check: eligible collections that also hold a Mystery Pack. A code limited to such a
 * collection could pay for a pack, so these can't be saved as eligible.
 */
export async function collectionsWithPacks(admin: AdminApiContext, collectionIds: string[], productType = "Mystery Pack") {
  if (collectionIds.length === 0) return [];
  const data = await gql(admin, `#graphql
    query PackCollections($q: String!) {
      products(first: 50, query: $q) { nodes { id collections(first: 100) { nodes { id title } } } }
    }`, { q: `product_type:'${productType}'` });
  const bad = new Map<string, string>();
  for (const p of data.products.nodes as { collections: { nodes: { id: string; title: string }[] } }[]) {
    for (const c of p.collections.nodes) if (collectionIds.includes(c.id)) bad.set(c.id, c.title);
  }
  return [...bad.values()];
}
