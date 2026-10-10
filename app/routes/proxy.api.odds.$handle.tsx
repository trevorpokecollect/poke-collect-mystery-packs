import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { seriesOdds } from "../lib/pool.server";
import { json, proxyContext } from "../lib/proxy.server";

// Public odds for a series: every card, copies left and current odds.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await proxyContext(request);
  const odds = await seriesOdds(db, shop, params.handle ?? "");
  return odds ? json(odds) : json({ error: "Series not found." }, 404);
};
