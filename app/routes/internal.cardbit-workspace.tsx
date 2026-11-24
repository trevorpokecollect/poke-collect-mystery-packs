import {
  ownerView as giveawayDesk,
  manage as manageGiveaway,
  entryExport,
} from "../giveaway/service.server";
import { closeDue } from "../giveaway/draw.server";
import { liveWorkspace } from "../workspace/mode.server";
import { workspacePackProducts } from "../workspace/pack-products.server";
import { marketApproved } from "../workspace/market.server";
import { createHash, timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { json } from "../lib/proxy.server";
import { changeBook, enabled, readBook } from "../workspace/book.server";
import {
  account,
  adjust,
  directory,
  lookup,
  verifyAccount,
} from "../workspace/customers.server";
import { pools, build, commitPool, discard } from "../workspace/pools.server";
import { refresh } from "../workspace/sources.server";
import { vault } from "../workspace/portfolio.server";
import { shelfPage,confirmFiled } from "../workspace/shelf.server";
import { staffShipping } from "../workspace/fulfillment.server";
import { inventoryTotals } from "../workspace/totals.server";
function verifiedActor(request: Request) {
  const key = process.env.CARDBIT_DESK_SECRET,
    owner = process.env.CARDBIT_OWNER_EMAIL?.trim().toLowerCase(),
    pinned = process.env.CARDBIT_OWNER_STAFF_ID;
  const actor = request.headers.get("x-cardbit-owner") ?? "";
  if (
    !enabled(shop) ||
    !key ||
    key.length < 32 ||
    !owner ||
    request.headers.get("x-cardbit-owner-email")?.toLowerCase() !== owner ||
    !/^[A-Za-z0-9_-]{1,150}$/.test(actor) ||
    (pinned && actor !== pinned) ||
    request.headers.get("x-cardbit-shop") !== shop
  )
    return null;
  const hash = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(
    hash(request.headers.get("Authorization") || ""),
    hash("Bearer " + key),
  )
    ? actor
    : null;
}
export async function action({ request }: ActionFunctionArgs) {
  const actor = verifiedActor(request);
  if (request.method !== "POST" || !actor)
    return json({ error: "Workspace unavailable." }, 403);
  const data = await request.text();
  if (data.length > 7600000)
    return json({ error: "Request is too large." }, 413);
  try {
    const input = JSON.parse(data);
    if (data.length > 180000 && input.action !== "giveaway-campaign")
      return json({ error: "Request is too large." }, 413);
    const installation = await unauthenticated.admin(shop);
    const { admin, session } = installation;
    if (session.shop !== shop)
      return json({ error: "Incorrect Cardbit installation." }, 403);
    const direct = liveWorkspace(shop);
    if (direct && input.source && input.source !== "wallet")
      return json({ error: "Choose a Cardbit customer wallet." }, 400);
    switch (input.action) {
      case "shelf":
      case "fileCopy":
      case "orders":
      case "order":
      case "deliveryAddress":
      case "prepareShipment":
      case "checkShipment":
      case "packShipment":
      case "shipParcel":
      case "releasePick":
      case "buyLabel":
      case "labelStatus":
        if (!direct) return json({error:"Physical operations require the Cardbit owner workspace."},403);
        if (input.action==="shelf") return json(await shelfPage(db,input));
        if (input.action==="fileCopy") return json(await confirmFiled(db,input.copy,input.slot));
        return json(await staffShipping(db,admin,input,actor));
      case "giveaway-campaign": {
        const { campaignDesk } = await import("../giveaway/campaigns.server");
        return json(await campaignDesk(installation, input));
      }
      case "giveaway-products": {
        const { campaignProducts } =
          await import("../giveaway/campaigns.server");
        return json(await campaignProducts(admin, input.search));
      }
      case "giveaway-export":
        return json(await entryExport(db, input));
      case "giveaway-desk":
        return json(await giveawayDesk(db, input));
      case "giveaway-manage":
        await manageGiveaway(db, actor, input);
        return json(await giveawayDesk(db, input));
      case "giveaway-close":
        await closeDue(db, admin);
        return json(await giveawayDesk(db, input));
      case "home": {
        const [book, series, customers, packProducts] = await Promise.all([
          readBook(db),
          pools(db),
          directory(db, admin),
          direct ? workspacePackProducts(admin, db) : undefined,
        ]);
        return json({
          series,
          customers,
          packProducts,
          live: direct,
          policy: book.policy,
          revision: book.revision,
          prices: Object.values(book.refs),
          refreshed: book.refreshed,
          marketApproved: marketApproved(),
        });
      }
      case "lookup":
        return json(await lookup(db, admin, input.query));
      case "account":
        await verifyAccount(admin, input.customerId, input.source);
        return json(await account(db, input.customerId, input.source));
      case "adjust":
        await verifyAccount(admin, input.customerId, input.source);
        return json(
          await adjust(
            db,
            input.customerId,
            input.source,
            input.delta,
            input.reason,
            input.requestId,
            actor,
          ),
        );
      case "build":
        return json(await build(db, admin, input.recipe, input.requestId));
      case "commit":
        return json(await commitPool(db, admin, input.id, input.revision));
      case "discard":
        if (direct) {
          const { discardWalletDraft } =
            await import("../workspace/launch.server");
          await discardWalletDraft(db, admin, input.id);
        } else await discard(db, input.id);
        return json({ ok: true });
      case "pricing":
        return json({
          revision: await changeBook(db, {
            policy: input.policy,
            expected: input.revision,
            actor,
          }),
        });
      case "refresh":
        await refresh(db, admin);
        return json({ ok: true });
      case "totals":
        return json(await inventoryTotals(db, admin));
      case "portfolio":
        return json(
          await vault(
            db,
            admin,
            input.customerId,
            input.source === "shopper" ? "shopper" : "wallet",
          ),
        );
      default:
        return json({ error: "Choose a workspace action." }, 400);
    }
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Workspace unavailable.";
    return json(
      {
        error:
          msg.length < 260 &&
          !/prisma|database|https?:|token|graphql/i.test(msg)
            ? msg
            : "Could not complete this request. Reload and try again.",
      },
      409,
    );
  }
}
