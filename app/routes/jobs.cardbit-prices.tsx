import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { liveWorkspace } from "../workspace/mode.server";
import { enabled } from "../workspace/book.server";
import { refresh } from "../workspace/sources.server";
import { vault } from "../workspace/portfolio.server";
export async function action({ request }: ActionFunctionArgs) {
  if (
    !enabled(shop) ||
    !process.env.CRON_SECRET ||
    request.headers.get("Authorization") !== "Bearer " + process.env.CRON_SECRET
  )
    return new Response(null, { status: 403 });
  const { admin } = await unauthenticated.admin(shop);
  await refresh(db, admin);
  const demos = liveWorkspace(shop)
    ? []
    : await db.cardbitDemoAccount.findMany({
        where: { shop },
        select: { customerId: true },
      });
  const owners = await db.pull.findMany({
    where: { shop, customerId: { startsWith: "gid://shopify/Customer/" } },
    distinct: ["customerId"],
    select: { customerId: true },
  });
  const previous = await db.cardbitVaultMark.findMany({
    where: { shop, source: "wallet" },
    distinct: ["customer"],
    select: { customer: true },
  });
  let failed = 0;
  async function observe(customer: string, source: "shopper" | "wallet") {
    try {
      await vault(db, admin, customer, source);
    } catch {
      failed++;
    }
  }
  for (const d of demos) await observe(d.customerId, "shopper");
  for (const id of new Set([
    ...owners.map((o) => o.customerId),
    ...previous.map((o) => o.customer),
  ]))
    if (id) await observe(id, "wallet");
  return Response.json(
    { updated: true, unrecorded: failed },
    { status: failed ? 503 : 200 },
  );
}
