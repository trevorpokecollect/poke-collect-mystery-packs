import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { json, proxyContext } from "../lib/proxy.server";
import { enabled, readBook } from "../workspace/book.server";
import { offer, poolRetail } from "../workspace/model";

// Public storefront prices only. Do not expose merchant IDs, cash quotes or stock.
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, session } = await proxyContext(request);
  if (!session || session.shop !== shop || !enabled(shop)) return json({}, 404);
  const book = await readBook(db);
  const quotes: Record<string, { market: number; retail: number; bits: number }> = {};
  for (const [key, ref] of Object.entries(book.refs)) {
    if (key.split("|")[1] !== "ja" || ref.quoteSource !== "merchant") continue;
    const bits = offer(ref, book.policy), retail = poolRetail(ref);
    if (bits && retail && ref.market) quotes[key] = { market: ref.market, retail, bits };
  }
  return json({ quotes, refreshed: book.refreshed });
}
