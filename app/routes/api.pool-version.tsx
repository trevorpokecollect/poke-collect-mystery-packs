// GET /api/pool-version?pack=<packId>&v=<version>: one published pack pool version (verified restocks),
// with every copy id, card title and the SHA-256 hash, so anyone can recheck an opening's pool.
// GET /api/pool-version?pack=<packId>: that pack's restock history (newest first). No customer or staff data.
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { siteOn } from "../site/store/http.server";
import { poolVersion, restockHistory } from "../site/core/restock.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": status === 200 ? "public, max-age=30" : "no-store" } });

export async function loader({ request }: LoaderFunctionArgs) {
  if (!siteOn()) return new Response("Not found", { status: 404 });
  const u = new URL(request.url);
  const pack = (u.searchParams.get("pack") || "").slice(0, 100);
  if (!pack) return json({ error: "Choose a pack." }, 400);
  const v = u.searchParams.get("v");
  if (v === null) return json({ packId: pack, restocks: (await restockHistory(db, [pack], 200)).get(pack) ?? [] });
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) return json({ error: "Unknown version." }, 400);
  const out = await poolVersion(db, pack, n);
  return out ? json(out) : json({ error: "Unknown version." }, 404);
}
