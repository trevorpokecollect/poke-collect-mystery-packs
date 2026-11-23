import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { proxyContext, json } from "../lib/proxy.server";
import { liveWorkspace } from "../workspace/mode.server";
import { enabled } from "../workspace/book.server";
import { vault } from "../workspace/portfolio.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, session, viewer, admin } = await proxyContext(request);
  if (!enabled(shop) || session?.shop !== shop || !admin)
    return json({ error: "Portfolio unavailable." }, 404);
  if (
    !viewer?.customerId ||
    !/^gid:\/\/shopify\/Customer\/\d+$/.test(viewer.customerId)
  )
    return json({ error: "Sign in to view your vault portfolio." }, 401);
  const source =
    new URL(request.url).searchParams.get("source") === "shopper"
      ? "shopper"
      : "wallet";
  if (liveWorkspace(shop) && source !== "wallet")
    return json({ error: "Portfolio unavailable." }, 404);
  try {
    const data = await vault(db, admin, viewer.customerId, source);
    return json({
      ...data,
      holdings: data.holdings.map((h) => ({
        key: h.key,
        name: h.name,
        set: h.set,
        number: h.number,
        finish: h.finish,
        condition: h.condition,
        language: h.language,
        qty: h.qty,
        bits: h.bits,
        market: h.market,
        marketDate: h.marketDate,
        retailDate: h.retailDate,
        history: h.history,
      })),
    });
  } catch {
    return json(
      { error: "Your portfolio could not be loaded. Try again." },
      503,
    );
  }
}
