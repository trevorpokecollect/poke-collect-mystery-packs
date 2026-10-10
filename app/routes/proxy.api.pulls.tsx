import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { pullsForViewer } from "../lib/pool.server";
import { json, proxyContext } from "../lib/proxy.server";

// Lists the viewer's packs. Unopened packs never include the card.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, viewer } = await proxyContext(request);
  if (!viewer) return json({ error: "Log in to see your packs." }, 401);

  const pulls = await pullsForViewer(db, shop, viewer);
  return json({
    packs: pulls.map((p) => ({
      id: p.id,
      series: p.series.title,
      orderName: p.orderName,
      opened: p.status !== "UNOPENED",
      shipped: p.status === "FULFILLING",
      card:
        p.status === "UNOPENED"
          ? null
          : {
              title: p.slot.card.title,
              tier: p.slot.card.tier,
              imageUrl: p.slot.card.imageUrl,
              marketValue: p.slot.card.marketValue.toString(),
            },
    })),
  });
};
