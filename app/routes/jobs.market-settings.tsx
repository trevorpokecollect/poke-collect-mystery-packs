import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { marketSettings, TRADE_WAIT_DAYS, updateMarketSettings } from "../lib/market.server";

// Staff switch for Vault Market settings from outside the admin (e.g. the soft launch):
// POST /jobs/market-settings?shop=<shop> with the cron secret and a JSON body of
// { enabled?, sellingEnabled?, feePercent?, accessTag? }. Also reports how many vault cards
// are past the trade hold, so a launch can be timed.
export const action = async ({ request }: ActionFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const shop = new URL(request.url).searchParams.get("shop");
  if (!shop) return Response.json({ error: "shop is required" }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
    sellingEnabled?: boolean;
    feePercent?: number;
    accessTag?: string | null;
  };
  const input: Parameters<typeof updateMarketSettings>[2] = {};
  if (typeof body.enabled === "boolean") input.enabled = body.enabled;
  if (typeof body.sellingEnabled === "boolean") input.sellingEnabled = body.sellingEnabled;
  if (typeof body.feePercent === "number") input.feePercent = body.feePercent;
  if (body.accessTag !== undefined) input.accessTag = body.accessTag ? String(body.accessTag).trim() : null;
  if (Object.keys(input).length) await updateMarketSettings(db, shop, input);

  const holdEnds = new Date(Date.now() - TRADE_WAIT_DAYS * 86_400_000);
  const [inVault, tradable, owners] = await Promise.all([
    db.pull.count({ where: { shop, status: "REVEALED", shipRequestId: null } }),
    db.pull.count({ where: { shop, status: "REVEALED", shipRequestId: null, createdAt: { lt: holdEnds } } }),
    db.pull.groupBy({ by: ["customerId"], where: { shop, status: "REVEALED", shipRequestId: null, createdAt: { lt: holdEnds } } }),
  ]);
  const byDay = await db.$queryRaw<{ day: Date; cards: bigint }[]>`
    SELECT date_trunc('day', "createdAt" + make_interval(days => ${TRADE_WAIT_DAYS}::int)) AS day, count(*) AS cards
    FROM "Pull" WHERE shop = ${shop} AND status = 'REVEALED' AND "shipRequestId" IS NULL AND "createdAt" >= ${holdEnds}
    GROUP BY 1 ORDER BY 1`;
  return Response.json({
    settings: await marketSettings(db, shop),
    vaultCards: inVault,
    tradableNow: tradable,
    collectorsWithTradableCards: owners.length,
    becomingTradable: byDay.map((d) => ({ day: d.day.toISOString().slice(0, 10), cards: Number(d.cards) })),
  });
};
