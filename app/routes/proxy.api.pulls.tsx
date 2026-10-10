import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { pullsForViewer } from "../lib/pool.server";
import { packImages } from "../lib/pack-art.server";
import { json, proxyContext } from "../lib/proxy.server";

// Lists the viewer's packs. Unopened packs never include the card. Card values are
// admin-only, so customers never see a dollar figure next to what they pulled.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, viewer, admin } = await proxyContext(request);
  if (!viewer) return json({ error: "Log in to see your packs." }, 401);

  const pulls = await pullsForViewer(db, shop, viewer);
  const art = await packImages(admin, [...new Set(pulls.map((p) => p.series.packProductId))]);
  return json({
    packs: pulls.map((p) => ({
      id: p.id,
      series: p.series.title,
      packImageUrl: art.get(p.series.packProductId) ?? null,
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
            },
    })),
  });
};
