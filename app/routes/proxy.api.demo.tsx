import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { availableSeries } from "../lib/pool.server";
import { packImages, packProducts } from "../lib/pack-art.server";
import { validDemoToken } from "../lib/demo.server";
import { json, proxyContext } from "../lib/proxy.server";
import { packShelf } from "../lib/shelf.server";
import { FREE_SHIPPING_CARDS, SHIP_FEE } from "../lib/vault.server";

// Sample data for the My Packs preview (/apps/packs?demo=<token>[&series=<handle>]). Cards come from
// the given series, or the newest live series so the page and the opening animation look exactly like a real customer's.
// Nothing here touches orders, the pool or inventory.
const SHIPPING = [
  { state: "vault" },
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
  // &series=<handle> previews one series' pool, drafts included (the series page links to it).
  const handle = new URL(request.url).searchParams.get("series");
  const series =
    (handle ? await db.series.findFirst({ where: { shop, handle } }) : null) ??
    live[0]?.series ??
    (await db.series.findFirst({ where: { shop }, orderBy: { createdAt: "desc" } }));
  if (!series) return json({ error: "Create a series first to preview My Packs." }, 404);

  const cards = await db.card.findMany({ where: { seriesId: series.id } });
  const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
  // One pull from each tier, plus unopened packs that open to random cards from the pool.
  const tiers = [...new Set(cards.map((c) => c.tier))];
  const pulled = tiers.map((tier) => pick(cards.filter((c) => c.tier === tier)));
  const perPack = Math.max(1, series.cardsPerPack);
  // Each sample pack holds as many cards as the series puts in a pack, cheapest first like a real opening.
  const samplePack = () =>
    Array.from({ length: perPack }, () => pick(cards)).sort((a, b) => Number(a.marketValue) - Number(b.marketValue));
  const unopened = cards.length ? [samplePack(), samplePack(), samplePack()] : [];

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
    vault: { cards: pulled.length, fee: SHIP_FEE, freeAt: FREE_SHIPPING_CARDS, pending: null },
    packs: [
      ...unopened.map((pack, i) => ({
        id: `demo-${i}`,
        cardsPerPack: perPack,
        series: series.title,
        packImageUrl,
        orderName: "#PREVIEW",
        opened: false,
        card: null,
        demoCard: show(pack[pack.length - 1]),
        demoCards: perPack > 1 ? pack.map(show) : null,
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
