// Card Broker "Inventory" tab ↔ site stock. Server-to-server only (pairing secret).
// GET  ?status=&q=&cursor=&limit=  or POST {status?, q?, slot?, after?, limit?} (no intent) → listStock()
// POST {intent:"price", printingKey, condition, priceBits|null, buybackBits|null}
//      {intent:"pool", copyIds, packId} | {intent:"unpool", copyIds}   (pools fill from DRAFT; unpool → DRAFT)
//      {intent:"activate", copyIds} (DRAFT → FOR_SALE) | {intent:"draft", copyIds} (FOR_SALE → DRAFT)
//      {intent:"pack", packId, priceBits, cardsPerPack, active}
//      Restocks (pools change only when published): "pool"/"unpool" STAGE copies for the pack's next restock;
//      {intent:"restocks"} → staged restock + odds now/after + history per pack
//      {intent:"restock-unstage", copyIds} | {intent:"restock-publish", packId, note?} (goes live now, new pool version)
//      {intent:"pack-ev", packId, targetEvPct|null, evBandPct, minTopPer100|null, languages?, eras?,
//        minValueBits?, maxValueBits?, typeCaps?, tierMix?, topTierMin?, autoDrafts?} (only sent fields change; EV/rules internal only)
//      {intent:"restock-auto-stage", copyIds | "all"} picks the pack for each Draft card (same rules as Auto-Fill, no
//        2-hour wait) and STAGES it there; {intent:"restock-publish-all", note?} publishes every staged restock now
//      {intent:"auto-restock-run"} runs the hourly automatic restock now (buybacks + listed Drafts for Auto-Fill packs)
//      {intent:"remove", copyIds, reason} deletes unsold Draft/Active copies (→ REMOVED, pocket freed, logged)
//      {intent:"slot", copyId, slot, pocket?} moves one copy to a chosen slot (10001+) and pocket
//      {intent:"relink", copyId, product:{game,setName,number,finish,language,name,title,tcgplayerId,image}, priceBits?, buybackBits?}
//      switches an unsold Draft/Active copy to the right TCGplayer product (same set/number/finish/language), logged
//      {intent:"boxes"} cards and slots used per box (Card Broker box claiming)
//      Prize pools (Trevor, Nov 26): Daily Spin pools (kind "spin") and the Spark Shop (kind "sparks") come back from
//      "restocks" with kind + fill; "pack-ev" also takes fillTargets [{minBits, maxBits|null, count}] for them.
//      {intent:"spin-table"} → Daily Spin prize table (results, odds, pool size, card cap per spin)
//      {intent:"spin-table-save", tier, results:[{kind:"card"|"sparks"|"xp", min?, max?, weight}]} saves one spin
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { brokerActor, cardBrokerAuthorized } from "../site/core/internal-auth.server";
import { DeskError, boxSummary, fixPooledCopy, listStock, moveToSlot, movePool, relinkCopy, removeCopies, savePack, setListing, setPrice } from "../site/core/stock-desk.server";
import { RestockError, autoStageDrafts, publishAllStaged, publishRestock, runAutoRestock, savePackEv, stagedRestocks, unstageRestock } from "../site/core/restock.server";
import { applyBrokerPrice, intakePrice, priceKey } from "../site/core/stock.server";
import { SpinTableError, saveSiteSpinTier, siteSpinTableView } from "../site/rewards/spin-table.server";

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
      case "restocks":
        return Response.json({ ok: true, packs: await stagedRestocks(db) }, { headers: { "Cache-Control": "no-store" } });
      case "restock-unstage":
        return Response.json({ ok: true, ...(await unstageRestock(db, actor, b.copyIds)) });
      case "restock-publish": {
        const r = await publishRestock(db, actor, String(b.packId || ""), b.note);
        return Response.json({ ok: true, restock: { packId: r.packId, version: r.version, poolHash: r.poolHash, poolSize: r.poolSize, added: (r.addIds as string[]).length, removed: (r.removeIds as string[]).length } });
      }
      // Auto-pick packs (Trevor, Nov 27 2026): staff don't choose the pack; nothing is live until published.
      case "restock-auto-stage":
        return Response.json({ ok: true, ...(await autoStageDrafts(db, actor, b.copyIds === "all" ? "all" : b.copyIds)) });
      case "restock-publish-all":
        return Response.json({ ok: true, ...(await publishAllStaged(db, actor, b.note)) });
      case "pack-ev": {
        const p = await savePackEv(db, String(b.packId || ""), b);
        return Response.json({ ok: true, pack: { id: p.id, kind: p.kind, targetEvPct: p.targetEvPct, evBandPct: p.evBandPct, minTopPer100: p.minTopPer100, languages: p.languages, eras: p.eras, autoDrafts: p.autoDrafts, fillTargets: p.fillTargets } });
      }
      case "remove":
        return Response.json({ ok: true, ...(await removeCopies(db, actor, b.copyIds, b.reason)) });
      case "boxes":
        return Response.json({ ok: true, boxes: await boxSummary(db) }, { headers: { "Cache-Control": "no-store" } });
      case "slot":
        return Response.json({ ok: true, ...(await moveToSlot(db, actor, b.copyId, b.slot, b.pocket)) });
      case "relink": {
        const r = await relinkCopy(db, actor, b.copyId, b.product as Record<string, unknown> | undefined);
        const price = intakePrice(b);
        if (price) await applyBrokerPrice(db, priceKey(r.printingKey, r.condition), price);
        return Response.json({ ok: true, ...r });
      }
      // Fix or delete a pooled card (Trevor, Nov 27 2026): leaves the pool as a published correction version first.
      case "pool-fix": {
        const r = await fixPooledCopy(db, actor, {
          copyId: b.copyId,
          action: b.action,
          reason: b.reason,
          product: (b.product as Record<string, unknown> | undefined) ?? null,
          condition: b.condition,
        });
        const price = r.switched ? intakePrice(b) : null;
        if (price) await applyBrokerPrice(db, priceKey(r.printingKey, r.condition), price);
        return Response.json({ ok: true, ...r });
      }
      case "spin-table":
        return Response.json({ ok: true, ...(await siteSpinTableView(db)) }, { headers: { "Cache-Control": "no-store" } });
      case "spin-table-save":
        return Response.json({ ok: true, ...(await saveSiteSpinTier(db, b.tier, b.results)) });
      case "auto-restock-run":
        return Response.json({ ok: true, ...(await runAutoRestock(db, { force: true })) });
      default:
        return Response.json({ error: "Unknown intent." }, { status: 422 });
    }
  } catch (e) {
    if (e instanceof DeskError || e instanceof RestockError || e instanceof SpinTableError) return Response.json({ error: e.message }, { status: 422 });
    throw e;
  }
}
