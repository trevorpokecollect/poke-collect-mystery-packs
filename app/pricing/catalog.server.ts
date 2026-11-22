import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { PrismaClient } from "@prisma/client";
import { gql } from "../lib/orders.server";
import { fetchBuylistOffers } from "../lib/buylist.server";
import Pricing, { type Catalog, type PriceCard } from "./calculator.mjs";

const money = (n: unknown) =>
  Number.isSafeInteger(n) && Number(n) > 0 && Number(n) <= 2147483647;
const rate = (n: unknown) =>
  Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= 10000;
const cleanKey = (k: unknown) =>
  typeof k === "string" &&
  k.length > 0 &&
  k.length < 256 &&
  !Object.hasOwn(Object.prototype, k) &&
  k !== "prototype";

export function unpackCatalog(value: unknown): Catalog | null {
  if (value == null) return null;
  const b = value as { data?: string; sha256?: string };
  if (typeof b.data !== "string" || b.data.length > 1000000)
    throw Error("Invalid pricing catalog");
  const bytes = gunzipSync(Buffer.from(b.data, "base64"), {
    maxOutputLength: 4000000,
  });
  if (createHash("sha256").update(bytes).digest("hex") !== b.sha256)
    throw Error("Incorrect pricing catalog digest");
  const c: Catalog = JSON.parse(bytes.toString("utf8"));
  if (
    !cleanKey(c.version) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(c.date) ||
    !Array.isArray(c.cards) ||
    c.cards.length > 10000 ||
    !Array.isArray(c.pools) ||
    !c.pools.length ||
    c.pools.length > 100
  )
    throw Error("Invalid pricing catalog header");
  const keys = new Set<string>();
  for (const card of c.cards) {
    if (
      !cleanKey(card.key) ||
      keys.has(card.key) ||
      ![
        card.name,
        card.id,
        card.no,
        card.set,
        card.finish,
        card.condition,
      ].every((s) => typeof s === "string") ||
      ![card.retail, card.cash, card.credit].every(money) ||
      ![card.market, card.value, card.buyback].every(
        (n) => n === null || n === 0 || money(n),
      )
    )
      throw Error("Invalid printing in pricing catalog");
    keys.add(card.key);
  }
  const ids = new Set<string>();
  for (const p of c.pools) {
    if (
      !cleanKey(p.id) ||
      ids.has(p.id) ||
      typeof p.title !== "string" ||
      !money(p.price) ||
      !money(p.draws) ||
      p.draws > 1000 ||
      p.pricing?.basis !== "poke-collect-retail" ||
      !Number.isSafeInteger(p.pricing.targetBps) ||
      p.pricing.targetBps <= 0 ||
      p.pricing.targetBps > 100000 ||
      !rate(p.pricing.buybackBps) ||
      !Array.isArray(p.rows) ||
      p.rows.length > 10000 ||
      new Set(p.rows.map((r) => r.i)).size !== p.rows.length ||
      p.rows.some(
        (r) =>
          !Number.isSafeInteger(r.i) ||
          !c.cards[r.i] ||
          !money(r.qty) ||
          r.qty > 100000 ||
          typeof r.tier !== "string",
      )
    )
      throw Error("Invalid pricing pool");
    ids.add(p.id);
  }
  return c;
}

type Db = Pick<PrismaClient, "series" | "slot">;
export const deskSeries = (db: Db, shop: string) =>
  db.series.findMany({
    where: { shop, storePurchase: false },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, status: true },
  });

type Variant = {
  id: string;
  selectedOptions: { name: string; value: string }[];
  product: { vendor: string; tags: string[] };
};
// Card Broker listings use the Set_ tag, then the vendor from its set-name product template.
async function printingDetails(admin: AdminApiContext, variants: string[]) {
  const details = new Map<string, Variant>();
  const ids = [
    ...new Set(
      variants.filter((id) =>
        /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(id),
      ),
    ),
  ];
  for (let i = 0; i < ids.length; i += 100) {
    const result = await gql<{ nodes: (Variant | null)[] }>(
      admin,
      `#graphql
        query DeskPrintingDetails($ids:[ID!]!) {
          nodes(ids:$ids) { ... on ProductVariant { id selectedOptions { name value } product { vendor tags } } }
        }`,
      { ids: ids.slice(i, i + 100) },
    );
    for (const v of result.nodes) if (v?.id) details.set(v.id, v);
  }
  return details;
}

export async function loadCatalog(
  db: Db,
  admin: AdminApiContext,
  shop: string,
  seriesId: string | null,
) {
  if (!seriesId) {
    const result = await gql<{
      shop: {
        myshopifyDomain: string;
        metafield: { jsonValue: unknown } | null;
      };
    }>(
      admin,
      `#graphql
      query DeskCatalog { shop { myshopifyDomain metafield(namespace:"cardbit_staff_pricing",key:"catalog_v1"){jsonValue} } }`,
    );
    if (result.shop.myshopifyDomain !== shop)
      throw new Response("Shop unavailable", { status: 403 });
    const catalog = unpackCatalog(result.shop.metafield?.jsonValue);
    return {
      catalog,
      notice: catalog
        ? "Planning pools use dated Poke-Collect quotes and modeled quantities."
        : "No planning catalog is installed. Choose an app series to inspect its cards.",
    };
  }
  const series = await db.series.findFirst({
    where: { id: seriesId, shop, storePurchase: false },
    select: {
      id: true,
      title: true,
      status: true,
      packPrice: true,
      cardsPerPack: true,
      cards: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          title: true,
          tier: true,
          quantity: true,
          variantId: true,
        },
      },
    },
  });
  if (!series) throw new Response("Series unavailable", { status: 404 });
  const draws = Math.max(1, series.cardsPerPack);
  const quantities = new Map<string, number>();
  if (series.status === "DRAFT") {
    for (const card of series.cards) quantities.set(card.id, card.quantity);
  } else if (series.status === "LIVE") {
    const slots = await db.slot.findMany({
      where: {
        seriesId: series.id,
        claimed: false,
        voided: false,
        position: { not: null },
      },
      select: { cardId: true },
      orderBy: { position: "asc" },
    });
    const end = slots.length - (slots.length % draws);
    for (let i = 0; i < end; i++)
      quantities.set(
        slots[i].cardId,
        (quantities.get(slots[i].cardId) ?? 0) + 1,
      );
  }
  let offers: Awaited<ReturnType<typeof fetchBuylistOffers>> = new Map();
  let notice =
    series.status === "DRAFT"
      ? "Draft series quantities from Mystery Packs."
      : series.status === "LIVE"
        ? "Remaining copies in complete, unclaimed packs."
        : "This series is closed.";
  const ids = series.cards.map((c) => c.variantId);
  const [quotes, printings] = await Promise.allSettled([
    fetchBuylistOffers(ids),
    printingDetails(admin, ids),
  ]);
  if (quotes.status === "fulfilled") offers = quotes.value;
  else notice += " Cardbroker could not be reached. Reload to retry.";
  if (printings.status === "rejected")
    notice += " Shopify printing details are temporarily unavailable.";
  const details =
    printings.status === "fulfilled"
      ? printings.value
      : new Map<string, Variant>();
  const cards: PriceCard[] = series.cards.map((c) => {
    const offer = offers.get(c.variantId.split("/").pop()!);
    const variant = details.get(c.variantId);
    const setTag = variant?.product.tags.find((tag) => tag.startsWith("Set_"));
    const option = (name: string) =>
      variant?.selectedOptions.find((o) => o.name.toLowerCase() === name)
        ?.value ?? "";
    const cents = (n: number | null | undefined) =>
      typeof n === "number" && Number.isFinite(n) && n > 0
        ? Math.round(n * 100)
        : null;
    const buying =
      offer &&
      !offer.unavailable &&
      !offer.hiddenBy &&
      cents(offer.cash) &&
      cents(offer.credit);
    const retail = cents(offer?.retail);
    const payout = buying && retail ? Pricing.portion(retail, 8000) : null;
    return {
      key: c.variantId,
      id: c.variantId.split("/").pop()!,
      name: c.title,
      no: "",
      set: setTag?.slice(4) || variant?.product.vendor || "",
      finish: option("printing"),
      condition: option("condition"),
      market: null,
      retail,
      value: payout,
      buyback: payout,
      cash: buying ? cents(offer.cash) : null,
      credit: buying ? cents(offer.credit) : null,
    };
  });
  const catalog: Catalog = {
    version: "series-" + series.id,
    date: new Date().toISOString().slice(0, 10),
    cards,
    pools: [
      {
        id: series.id,
        title: series.title,
        price: Math.round(Number(series.packPrice) * 100),
        draws,
        pricing: {
          basis: "poke-collect-retail",
          targetBps: 10000,
          buybackBps: 8000,
        },
        rows: series.cards.map((c, i) => ({
          i,
          qty: quantities.get(c.id) ?? 0,
          tier: c.tier,
        })),
      },
    ],
  };
  return { catalog, notice };
}
