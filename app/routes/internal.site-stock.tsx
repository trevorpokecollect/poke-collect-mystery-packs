// Card Broker "Inventory" tab ↔ site stock. Server-to-server only (pairing secret).
// GET  ?status=&q=&cursor=&limit=  or POST {status?, q?, slot?, after?, limit?} (no intent) → listStock()
// POST {intent:"price", printingKey, condition, priceBits|null, buybackBits|null}
//      {intent:"pool", copyIds, packId} | {intent:"unpool", copyIds}   (pools fill from DRAFT; unpool → DRAFT)
//      {intent:"activate", copyIds} (DRAFT → FOR_SALE) | {intent:"draft", copyIds} (FOR_SALE → DRAFT)
//      {intent:"pack", packId, priceBits, cardsPerPack, active}
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { brokerActor, cardBrokerAuthorized } from "../site/core/internal-auth.server";
import { DeskError, listStock, movePool, savePack, setListing, setPrice } from "../site/core/stock-desk.server";

const deny = () => Response.json({ error: "Unavailable." }, { status: 403, headers: { "Cache-Control": "no-store" } });

export async function loader({ request }: LoaderFunctionArgs) {
  if (!cardBrokerAuthorized(request)) return deny();
  const u = new URL(request.url);
  const data = await listStock(db, {
    status: u.searchParams.get("status") || undefined,
    q: u.searchParams.get("q") || undefined,
    cursor: u.searchParams.get("cursor") || undefined,
    limit: Number(u.searchParams.get("limit")) || undefined,
  });
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST" || !cardBrokerAuthorized(request)) return deny();
  const raw = await request.text();
  if (raw.length > 64_000) return Response.json({ error: "Too large." }, { status: 413 });
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 422 });
  }
  const actor = brokerActor(request);
  if (b.intent === undefined || b.intent === "list") {
    const limit = Number(b.limit);
    return Response.json(
      await listStock(db, {
        status: typeof b.status === "string" ? b.status : undefined,
        q: typeof b.q === "string" ? b.q : undefined,
        cursor: typeof b.after === "string" ? b.after : typeof b.cursor === "string" ? b.cursor : undefined,
        limit: Number.isInteger(limit) ? Math.min(limit, 100) : 50,
        slot: Number.isInteger(b.slot) ? (b.slot as number) : undefined,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    switch (b.intent) {
      case "price": {
        const p = await setPrice(db, actor, String(b.printingKey || ""), String(b.condition || ""), b.priceBits, b.buybackBits);
        return Response.json({ ok: true, price: { printingKey: String(b.printingKey), condition: String(b.condition), priceBits: p.retailBits, buybackBits: p.buybackBits } });
      }
      case "pool":
        return Response.json({ ok: true, ...(await movePool(db, actor, (b.copyIds as string[]) || [], String(b.packId || "") || "missing")) });
      case "unpool":
        return Response.json({ ok: true, ...(await movePool(db, actor, (b.copyIds as string[]) || [], null)) });
      case "activate":
      case "draft":
        return Response.json({ ok: true, ...(await setListing(db, actor, (b.copyIds as string[]) || [], b.intent === "activate")) });
      case "pack": {
        const p = await savePack(db, String(b.packId || ""), b.priceBits, b.cardsPerPack, b.active === true);
        return Response.json({ ok: true, pack: { id: p.id, priceBits: p.priceBits, cardsPerPack: p.cardsPerPack, active: p.active } });
      }
      default:
        return Response.json({ error: "Unknown intent." }, { status: 422 });
    }
  } catch (e) {
    if (e instanceof DeskError) return Response.json({ error: e.message }, { status: 422 });
    throw e;
  }
}
