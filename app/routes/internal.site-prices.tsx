// Card Broker → site price feed. Card Broker owns retail prices and buyback offers.
// POST {prices:[{game, setName, number, finish, language, condition, priceBits|null, buybackBits|null}]} (≤1000)
// → {updated, skipped:[{index, error}]}. Same auth as intake. Printings with no site copies are
// still stored, so a price is ready when the first copy arrives.
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { cardBrokerAuthorized } from "../site/core/internal-auth.server";
import { IntakeRejected, applyBrokerPrice, intakePrice, priceKey, printingKey } from "../site/core/stock.server";

export const loader = () => new Response("Not found", { status: 404 });

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST" || !cardBrokerAuthorized(request)) return Response.json({ error: "Unavailable." }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 512_000) return Response.json({ error: "Too large." }, { status: 413 });
  let body: { prices?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 422 });
  }
  if (!Array.isArray(body.prices) || body.prices.length > 1000) return Response.json({ error: "Send 1 to 1000 prices." }, { status: 422 });
  let updated = 0;
  const skipped: { index: number; error: string }[] = [];
  for (const [index, p] of (body.prices as Record<string, unknown>[]).entries()) {
    try {
      const str = (k: string) => {
        const v = p?.[k];
        if (typeof v !== "string" || !v.trim() || v.length > 350) throw new IntakeRejected(`Missing ${k}.`, 422);
        return v;
      };
      const id = { game: str("game"), setName: str("setName"), number: str("number"), finish: str("finish"), language: str("language") };
      const price = intakePrice(p);
      if (!price) throw new IntakeRejected("Missing priceBits/buybackBits.", 422);
      await applyBrokerPrice(db, priceKey(printingKey(id), str("condition")), price);
      updated++;
    } catch (e) {
      if (e instanceof IntakeRejected) skipped.push({ index, error: e.message });
      else throw e;
    }
  }
  return Response.json({ updated, skipped });
}
