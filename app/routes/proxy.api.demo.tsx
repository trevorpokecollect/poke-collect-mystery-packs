import type { LoaderFunctionArgs } from "react-router";
import { isCardbit, samplePack } from "../lib/cardbit.server";
import db from "../db.server";
import { availableSeries } from "../lib/pool.server";
import { packImages, packProducts } from "../lib/pack-art.server";
import { validDemoToken } from "../lib/demo.server";
import { json, proxyContext } from "../lib/proxy.server";
import { cardLanguages } from "../lib/card-language.server";
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

  if (isCardbit(shop) && handle && series.handle !== handle) return json({ error: "This series was not found." }, 404);
  const cards = await db.card.findMany({ where: { seriesId: series.id } });
  const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
  // One pull from each tier, plus unopened packs that open to random cards from the pool.
  const tiers = [...new Set(cards.map((c) => c.tier))];
  const pulled = tiers.map((tier) => pick(cards.filter((c) => c.tier === tier)));
  const perPack = Math.max(1, series.cardsPerPack);
  // Each sample pack holds as many cards as the series puts in a pack, cheapest first like a real opening.
  const legacySample = () =>
    Array.from({ length: perPack }, () => pick(cards)).sort((a, b) => Number(a.marketValue) - Number(b.marketValue));
  const remaining = isCardbit(shop) && series.status !== "DRAFT"
    ? await db.slot.groupBy({ by: ["cardId"], where: { seriesId: series.id, claimed: false, voided: false }, _count: { _all: true } }) : null;
  const stock = remaining && new Map(remaining.map(r => [r.cardId, r._count._all]));
  const rows = cards.map(card => ({ card, copies: stock ? stock.get(card.id) ?? 0 : card.quantity }));
  const example = () => isCardbit(shop)
    ? samplePack(rows, perPack).sort((a, b) => Number(a.marketValue) - Number(b.marketValue)) : legacySample();
  const unopened = cards.length ? Array.from({ length: 3 }, example).filter(pack => pack.length === perPack) : [];

  const [art, products, languageOf] = await Promise.all([
    packImages(admin, [series.packProductId]),
    packProducts(admin, [...new Set([series.packProductId, ...live.map((l) => l.series.packProductId)])]),
    cardLanguages(admin, cards.map((c) => c.productId)),
  ]);
  const packImageUrl = art.get(series.packProductId) ?? null;
  const show = (c: (typeof cards)[number]) => ({ title: c.title, tier: c.tier, imageUrl: c.imageUrl, language: languageOf(c.productId) });

  return json({
    demo: true,
    signedIn: true,
    recommendFrom: series.packProductId.split("/").pop(),
    recommendHandle: products.get(series.packProductId)?.handle ?? null,
    available: packShelf(live, products),
    vault: { cards: pulled.length, ...(isCardbit(shop) ? {shippingMode:"destination",pickup:false} : {fee: SHIP_FEE,freeAt: FREE_SHIPPING_CARDS}), pending: null },
    packs: [
      ...unopened.map((pack, i) => ({
        id: `demo-${i}`,
        cardsPerPack: perPack,
        series: series.title,
        ...(isCardbit(shop) ? {productId:series.packProductId} : {}),
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
        ...(isCardbit(shop) ? {productId:series.packProductId} : {}),
        packImageUrl,
        orderName: "#PREVIEW",
        opened: true,
        card: show(c),
        shipping: isCardbit(shop) ? {state:"vault"} : SHIPPING[i % SHIPPING.length],
      })),
    ],
  });
};
