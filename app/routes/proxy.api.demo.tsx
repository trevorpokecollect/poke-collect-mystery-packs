import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { availableSeries } from "../lib/pool.server";
import { packImages, packProducts } from "../lib/pack-art.server";
import { validDemoToken } from "../lib/demo.server";
import { json, proxyContext } from "../lib/proxy.server";
import { packShelf } from "../lib/shelf.server";

// Sample data for the My Packs preview (/apps/packs?demo=<token>). Cards come from the newest
// live series so the page and the opening animation look exactly like a real customer's.
// Nothing here touches orders, the pool or inventory.
const SHIPPING = [
  { state: "preparing" },
  { state: "shipped", tracking: { number: "PREVIEW", url: "https://www.usps.com/" } },
  { state: "pickup_ready" },
  { state: "preparing" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, admin } = await proxyContext(request);
  if (!validDemoToken(shop, new URL(request.url).searchParams.get("demo"))) {
    return json({ error: "This preview link has expired. Open a new one from the app." }, 403);
  }

  const live = await availableSeries(db, shop);
  const series =
    live[0]?.series ?? (await db.series.findFirst({ where: { shop }, orderBy: { createdAt: "desc" } }));
  if (!series) return json({ error: "Create a series first to preview My Packs." }, 404);

  const cards = await db.card.findMany({ where: { seriesId: series.id } });
  const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
  // One pull from each tier, plus unopened packs that open to random cards from the pool.
  const tiers = [...new Set(cards.map((c) => c.tier))];
  const pulled = tiers.map((tier) => pick(cards.filter((c) => c.tier === tier)));
  const unopened = cards.length ? [pick(cards), pick(cards), pick(cards)] : [];

  const [art, products] = await Promise.all([
    packImages(admin, [series.packProductId]),
    packProducts(admin, [...new Set([series.packProductId, ...live.map((l) => l.series.packProductId)])]),
  ]);
  const packImageUrl = art.get(series.packProductId) ?? null;
  const show = (c: (typeof cards)[number]) => ({ title: c.title, tier: c.tier, imageUrl: c.imageUrl });

  return json({
    demo: true,
    signedIn: true,
    recommendFrom: series.packProductId.split("/").pop(),
    recommendHandle: products.get(series.packProductId)?.handle ?? null,
    available: packShelf(live, products),
    packs: [
      ...unopened.map((c, i) => ({
        id: `demo-${i}`,
        series: series.title,
        packImageUrl,
        orderName: "#PREVIEW",
        opened: false,
        card: null,
        demoCard: show(c),
      })),
      ...pulled.map((c, i) => ({
        id: `demo-pulled-${i}`,
        series: series.title,
        packImageUrl,
        orderName: "#PREVIEW",
        opened: true,
        card: show(c),
        shipping: SHIPPING[i % SHIPPING.length],
      })),
    ],
  });
};
