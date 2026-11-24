import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import type { ShopperState } from "../lib/demo-shopper.server";
import { gql } from "../lib/orders.server";
import { liveWorkspace } from "./mode.server";
import { asJson } from "./book.server";
import { isInt } from "./model";
export type AccountSource = "shopper" | "wallet";
const gid = /^gid:\/\/shopify\/Customer\/\d+$/;
type CustomerRecord = { id: string; displayName: string; email: string | null };
async function verifiedCustomer(admin: AdminApiContext, id: string) {
  if (!gid.test(id)) throw Error("Choose a Cardbit customer.");
  const { customer } = await gql<{ customer: CustomerRecord | null }>(
    admin,
    `#graphql
    query WorkspaceCustomer($id:ID!){customer(id:$id){id displayName email}}`,
    { id },
  );
  if (customer?.id !== id)
    throw Error("This customer could not be found on Cardbit.");
  return customer;
}
export async function lookup(
  db: PrismaClient,
  admin: AdminApiContext,
  query: string,
) {
  const value = String(query || "").trim();
  let customer: CustomerRecord | undefined;
  if (gid.test(value) || /^\d+$/.test(value)) {
    customer = await verifiedCustomer(
      admin,
      gid.test(value) ? value : "gid://shopify/Customer/" + value,
    );
  } else {
    if (
      value.length > 250 ||
      !/^[^\s"\\@]+@[^\s"\\@]+\.[^\s"\\@]+$/.test(value)
    )
      throw Error("Enter a complete email address or Shopify customer ID.");
    const result = await gql<{ customers: { nodes: CustomerRecord[] } }>(
      admin,
      `#graphql
      query FindWorkspaceCustomer($query:String!){customers(first:10,query:$query){nodes{id displayName email}}}`,
      { query: 'email:"' + value + '"' },
    );
    customer = result.customers.nodes.find(
      (c) => c.email?.toLowerCase() === value.toLowerCase(),
    );
  }
  if (!customer) throw Error("No Cardbit customer matched this email address.");
  const shopper =
    !liveWorkspace(shop) &&
    (await db.cardbitDemoAccount.findUnique({
      where: { shop_customerId: { shop, customerId: customer.id } },
      select: { customerId: true },
    }));
  return {
    name: customer.displayName,
    email: customer.email || "",
    customerId: customer.id,
    source: shopper ? "shopper" : "wallet",
  };
}
export async function verifyAccount(
  admin: AdminApiContext,
  customerId: string,
  source: AccountSource,
) {
  if (
    !["shopper", "wallet"].includes(source) ||
    (liveWorkspace(shop) && source !== "wallet")
  )
    throw Error("Choose a Cardbit customer wallet.");
  if (source === "wallet") await verifiedCustomer(admin, customerId);
}
export async function directory(db: PrismaClient, admin: AdminApiContext) {
  const [demo, wallets] = await Promise.all([
    liveWorkspace(shop)
      ? []
      : db.cardbitDemoAccount.findMany({
          where: { shop },
          select: { customerId: true },
        }),
    db.cardbitWallet.findMany({
      where: { shop },
      select: { customerId: true },
    }),
  ]);
  // Shopify customers without Cardbits activity have no wallet row yet. List the most recently
  // updated ones too, so a signed-up customer appears before their first ledger entry.
  const recent = await gql<{ customers: { nodes: CustomerRecord[] } }>(
    admin,
    `#graphql
    query RecentWorkspaceCustomers{customers(first:100,sortKey:UPDATED_AT,reverse:true){nodes{id displayName email}}}`,
  ).catch(() => ({ customers: { nodes: [] as CustomerRecord[] } }));
  const seen = new Set(wallets.map((r) => r.customerId));
  const rows = [
    ...demo.map((r) => ({ ...r, source: "shopper" as const })),
    ...wallets.map((r) => ({ ...r, source: "wallet" as const })),
    ...recent.customers.nodes
      .filter((c) => !seen.has(c.id))
      .map((c) => ({ customerId: c.id, source: "wallet" as const })),
  ].filter((r) => gid.test(r.customerId));
  const ids = [...new Set(rows.map((r) => r.customerId))],
    names = new Map<string, { displayName: string; email: string | null }>();
  for (let i = 0; i < ids.length; i += 100) {
    const data = await gql<{
      nodes: ({
        id: string;
        displayName: string;
        email: string | null;
      } | null)[];
    }>(
      admin,
      `#graphql
      query WorkspaceCustomers($ids:[ID!]!){nodes(ids:$ids){... on Customer{id displayName email}}}`,
      { ids: ids.slice(i, i + 100) },
    );
    for (const c of data.nodes) if (c) names.set(c.id, c);
  }
  return rows.map((r) => ({
    ...r,
    name:
      names.get(r.customerId)?.displayName ||
      "Customer " + r.customerId.split("/").pop(),
    email: names.get(r.customerId)?.email || "",
  }));
}
export async function account(
  db: PrismaClient,
  customerId: string,
  source: AccountSource,
) {
  if (!gid.test(customerId) || !["shopper", "wallet"].includes(source))
    throw Error("Choose a Cardbit account.");
  const where = { shop_customerId: { shop, customerId } };
  const staff = await db.cardbitReceipt.findMany({
    where: { shop, customerId, source },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  if (source === "shopper") {
    const row = await db.cardbitDemoAccount.findUniqueOrThrow({ where });
    const s = row.state as unknown as ShopperState;
    const notes = new Map(staff.map((r) => [r.id, r]));
    return {
      balance: s.balance,
      qualifying: 0,
      held: s.copies.filter((c) => c.status === "held").length,
      sealed: s.packs.filter((p) => p.sealed).length,
      shipments: s.shipments.length,
      history: s.history
        .slice(-100)
        .reverse()
        .map((r) => ({
          label: r.label,
          delta: r.delta,
          at: r.at,
          note: notes.get(r.id)?.reason ?? null,
          actor: notes.get(r.id)?.actorId ?? null,
          after: notes.get(r.id)?.balanceAfter ?? null,
        })),
    };
  }
  const [wallet, held, sealed, shipments, total] = await Promise.all([
    db.cardbitWallet.findUnique({ where }),
    db.pull.count({
      where: { shop, customerId, status: "REVEALED", shipRequestId: null },
    }),
    db.pull.groupBy({
      by: ["lineItemId", "packIndex"],
      where: { shop, customerId, status: "UNOPENED" },
    }),
    db.shipRequest.count({ where: { shop, customerId } }),
    db.cardbitReceipt.aggregate({
      where: { shop, customerId, source },
      _sum: { qualifyingPaidCents: true },
    }),
  ]);
  return {
    balance: wallet?.balance ?? 0,
    qualifying: total._sum.qualifyingPaidCents ?? 0,
    held,
    sealed: sealed.length,
    shipments,
    history: staff.map((r) => ({
      label: r.kind,
      delta: r.delta,
      at: r.createdAt.toISOString(),
      note: r.reason,
      actor: r.actorId,
      after: r.balanceAfter,
    })),
  };
}
export async function adjust(
  db: PrismaClient,
  customerId: string,
  source: AccountSource,
  delta: number,
  note: string,
  requestId: string,
  actor: string,
) {
  if (
    !gid.test(customerId) ||
    !["shopper", "wallet"].includes(source) ||
    !isInt(Math.abs(delta), 1, 2147483647) ||
    typeof note !== "string" ||
    !note.trim() ||
    note.length > 300 ||
    !/^[a-f0-9-]{36}$/i.test(requestId)
  )
    throw Error("Enter a whole number of Cardbits and a reason.");
  const where = { shop_customerId: { shop, customerId } },
    eventKey = "staff/" + requestId;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([customerId, source, delta, note.trim(), actor]))
    .digest("hex");
  await db.$transaction(async (tx) => {
    // Use the same locks as the shopper checkout and the native wallet.
    if (source === "shopper")
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"demo-shopper/" + shop + "/" + customerId},0))::text`;
    else {
      await tx.cardbitWallet.upsert({
        where,
        create: { shop, customerId },
        update: {},
      });
      await tx.$queryRaw`SELECT "customerId" FROM "CardbitWallet" WHERE shop=${shop} AND "customerId"=${customerId} FOR UPDATE`;
    }
    const prior = await tx.cardbitReceipt.findUnique({
      where: { shop_eventKey: { shop, eventKey } },
    });
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw Error("This confirmation belongs to a different adjustment.");
      return;
    }
    const row =
      source === "shopper"
        ? await tx.cardbitDemoAccount.findUniqueOrThrow({ where })
        : null;
    const s = row?.state as unknown as ShopperState | undefined;
    const wallet = s
      ? null
      : await tx.cardbitWallet.findUniqueOrThrow({ where });
    if (wallet?.held) throw Error("This wallet is on payment review.");
    const balance = (s?.balance ?? wallet!.balance) + delta;
    if (!isInt(balance, 0, 2147483647))
      throw Error(
        "This adjustment would put the balance outside its supported range.",
      );
    const receipt = await tx.cardbitReceipt.create({
      data: {
        shop,
        customerId,
        eventKey,
        source,
        fingerprint,
        kind: "Staff adjustment",
        delta,
        reason: note.trim(),
        actorId: actor,
        balanceAfter: balance,
      },
    });
    if (s) {
      s.balance = balance;
      s.history.push({
        id: receipt.id,
        at: receipt.createdAt.toISOString(),
        label: "Staff adjustment",
        delta,
      });
      await tx.cardbitDemoAccount.update({ where, data: { state: asJson(s) } });
    } else await tx.cardbitWallet.update({ where, data: { balance } });
  });
  return account(db, customerId, source);
}
