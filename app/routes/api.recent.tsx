// GET /api/recent?limit=12: Live Pulls feed for the home page. Revealed, paid (non-demo) pulls only;
// never sealed or unopened packs, never customer data.
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { siteOn } from "../site/store/http.server";
import { recentPulls } from "../site/store/store.server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (!siteOn()) return new Response("Not found", { status: 404 });
  const limit = Number(new URL(request.url).searchParams.get("limit") || 12);
  const pulls = await recentPulls(db, limit);
  return new Response(JSON.stringify({ pulls }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=15" },
  });
}
