import { createHash, timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { IntakeRejected, receiveSiteIntake } from "../site/core/stock.server";

const SHOP = "hhuuev-81.myshopify.com";

// Card Broker → standalone site stock receipts. Only live on the site environment.
export async function action({ request }: ActionFunctionArgs) {
  const key = process.env.CARDBIT_SITE_INTAKE_SECRET;
  const hash = (v: string) => createHash("sha256").update(v).digest();
  if (
    process.env.CARDBIT_SITE !== "on" ||
    request.method !== "POST" ||
    !key ||
    key.length < 32 ||
    request.headers.get("x-cardbit-shop") !== SHOP ||
    !timingSafeEqual(hash(request.headers.get("authorization") || ""), hash("Bearer " + key))
  )
    return Response.json({ error: "Unavailable." }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 16000) return Response.json({ error: "Receipt too large." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Receipt is not valid JSON." }, { status: 422 });
  }
  try {
    return Response.json(await receiveSiteIntake(db, body));
  } catch (e) {
    if (e instanceof IntakeRejected) return Response.json({ error: e.message }, { status: e.status });
    console.error("site-intake failed", e);
    return Response.json({ error: "Cardbit could not record this receipt. It will be retried." }, { status: 500 });
  }
}
export const loader = () => new Response("Not found", { status: 404 });
