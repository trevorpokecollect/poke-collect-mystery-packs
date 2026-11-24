import { readFile } from "node:fs/promises";
import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { gql } from "../lib/orders.server";
import { CARDBIT_SHOP } from "../lib/cardbit.server";
import { fetchCandidates } from "../lib/inventory.server";
import { fetchBuylistOffers } from "../lib/buylist.server";
import { unpackCatalog } from "../pricing/catalog.server";
import { changeBook, readBook, type References } from "./book.server";
import { unpack, type Bundle } from "./demo-catalog.server";
import { japaneseSetMarkets, setPrintingKey } from "./market-chart.server";
import { marketApproved } from "./market.server";
import { printingKey, type Recipe, type Stock } from "./model";

type Card = {
  tcgplayerId: number;
  name: string;
  number: string | null;
  language: string;
  printing: string;
  set: { name: string } | null;
  market?: {
    market: string | null;
    marketAsOf: string | null;
    fetchedAt: string;
  } | null;
};
type StockMap = {
  variantId: string;
  // Cardbit's own Shopify price for this listing (set by Card Broker, mirroring Poke-Collect).
  price?: number | null;
  productId: string;
  condition: string;
  card: Card;
};
type InputRow = {
  id: string;
  name: string;
  no: string;
  set: string;
  finish: string;
  condition: string;
  language?: string;
  retail: number | null;
  cash: number | null;
};
type Feed = { date: string; cards: InputRow[] };
type Link = {
  tcgplayerId: string;
  language: string;
  printing: string;
  condition: string;
  merchantVariantId: string;
};

const cents = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 1000000
    ? Math.round(n * 100)
    : null;
export async function site<T>(path: string, params: URLSearchParams) {
  const key = process.env.CARD_BROKER_API_KEY,
    base = process.env.CARD_BROKER_API_URL;
  if (!key || !base)
    throw Error("Configure the Cardbit catalog and inventory connection.");
  const url = new URL(base),
    apiPath = url.pathname.replace(/\/+$/, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/api/v1"].includes(apiPath)
  )
    throw Error(
      "Use the HTTPS origin or /api/v1 base of the Card Broker Site API.",
    );
  url.pathname = "/api/v1/" + path;
  url.search = params.toString();
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: "Bearer " + key, Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok)
    throw Error(
      "Cardbroker could not refresh the catalog (" + res.status + ").",
    );
  return (await res.json()) as T;
}
async function pages<T>(path: string, filters: Record<string, string> = {}) {
  const items: T[] = [],
    seen = new Set<string>(),
    params = new URLSearchParams({ ...filters, limit: "200" });
  for (;;) {
    const page = await site<{ items: T[]; nextCursor?: string | null }>(
      path,
      params,
    );
    if (!Array.isArray(page.items))
      throw Error("Cardbroker returned an incomplete catalog.");
    items.push(...page.items);
    if (!page.nextCursor) return items;
    if (seen.has(page.nextCursor))
      throw Error("Cardbroker repeated a catalog page.");
    seen.add(page.nextCursor);
    params.set("cursor", page.nextCursor);
  }
}
function shopifyId(value: string, kind: "Product" | "ProductVariant") {
  if (typeof value !== "string") return null;
  const head = "gid://shopify/" + kind + "/",
    number = value.startsWith(head) ? value.slice(head.length) : value;
  return /^\d{1,20}$/.test(number) ? head + number : null;
}
// The live Site API has no key-introspection endpoint. Shopify verifies each variant/product pair
// on the authenticated Cardbit installation before it is admitted as operational inventory.
async function cardbitInventory(admin: AdminApiContext) {
  const incoming = await pages<StockMap>("inventory"),
    matched: StockMap[] = [];
  let ownedVariant = false;
  for (let i = 0; i < incoming.length; i += 100) {
    const rows = incoming.slice(i, i + 100),
      ids = rows
        .map((row) => shopifyId(row.variantId, "ProductVariant"))
        .filter((id): id is string => !!id);
    if (!ids.length) continue;
    const data = await gql<{
      shop: { myshopifyDomain: string };
      nodes: ({
        id: string;
        price: string;
        product: { id: string; productType: string };
      } | null)[];
    }>(
      admin,
      `#graphql
      query WorkspaceVariantOwnership($ids:[ID!]!){shop{myshopifyDomain} nodes(ids:$ids){... on ProductVariant{id price product{id productType}}}}`,
      { ids },
    );
    if (data.shop.myshopifyDomain !== CARDBIT_SHOP)
      throw Error("Incorrect Cardbit inventory installation.");
    const owned = new Map(
      data.nodes.filter((n) => !!n).map((n) => [n!.id, n!]),
    );
    for (const row of rows) {
      const id = shopifyId(row.variantId, "ProductVariant"),
        node = id ? owned.get(id) : null,
        product = node?.product;
      if (
        id &&
        product &&
        product.id === shopifyId(row.productId, "Product") &&
        ["Pokemon Single", "Pokemon Japanese Single"].includes(
          product.productType,
        )
      )
        matched.push({ ...row, variantId: id, price: cents(Number(node!.price)) });
    }
    if (data.nodes.some(Boolean)) ownedVariant = true;
  }
  if (incoming.length && !ownedVariant)
    throw Error(
      "The Site API inventory does not match this Cardbit Shopify store.",
    );
  return matched;
}
function merchantVariants(raw: unknown) {
  const map = new Map<string, string>(),
    byVariant = new Map<string, string>();
  if (raw == null) return map;
  if (!Array.isArray(raw) || raw.length > 20000)
    throw Error("The merchant variant map must contain exact printings.");
  for (const link of raw as Link[]) {
    const key =
      link &&
      printingKey(
        link.tcgplayerId,
        link.language,
        link.printing,
        link.condition,
      );
    const id =
      link &&
      shopifyId(link.merchantVariantId, "ProductVariant")?.split("/").pop();
    if (
      !key ||
      !id ||
      (map.has(key) && map.get(key) !== id) ||
      (byVariant.has(id) && byVariant.get(id) !== key)
    )
      throw Error(
        "The merchant variant map contains an invalid or conflicting printing.",
      );
    map.set(key, id);
    byVariant.set(id, key);
  }
  return map;
}
function stockRow(v: StockMap): InputRow {
  const c = v.card;
  return {
    id: String(c.tcgplayerId),
    name: c.name || String(c.tcgplayerId),
    no: c.number || "",
    set: c.set?.name || "",
    finish: c.printing,
    condition: v.condition,
    language: c.language,
    retail: null,
    cash: null,
  };
}
// The signed catalog can retain owned or sealed printings after a pool has rotated.
async function shopperJapanesePrintings(admin: AdminApiContext) {
  const rows: InputRow[] = [];
  const versions = new Set<string>();
  let after: string | null = null;
  do {
    const page: {
      customers: {
        nodes: { catalog: { jsonValue: Bundle } | null }[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await gql(
      admin,
      `#graphql
      query JapaneseShopperCatalogs($after:String) {
        customers(first:5,after:$after,query:"tag:cardbit-demo-shopper") {
          pageInfo { hasNextPage endCursor }
          nodes { catalog:metafield(namespace:"cardbit_preview",key:"catalog_v1"){jsonValue} }
        }
      }`,
      { after },
    );
    for (const { catalog } of page.customers.nodes) {
      const archive = catalog?.jsonValue;
      if (!archive || versions.has(archive.version)) continue;
      versions.add(archive.version);
      const data = unpack(archive);
      for (const card of [...data.cards, ...(data.archivedCards ?? [])]) {
        const set = "set" in card && card.set,
          no = "number" in card && card.number;
        const key = printingKey(
          card.tcgplayerId,
          card.language || "",
          card.printing || "",
          card.condition || "",
        );
        if (
          key?.split("|")[1] !== "ja" ||
          typeof set !== "string" ||
          !set ||
          typeof no !== "string"
        )
          continue;
        rows.push({
          id: key.split("|")[0],
          name: card.name,
          no,
          set,
          language: "Japanese",
          finish: card.printing!,
          condition: card.condition!,
          cash: null,
          retail: null,
        });
      }
    }
    after = page.customers.pageInfo.hasNextPage
      ? page.customers.pageInfo.endCursor
      : null;
  } while (after);
  return rows;
}

// Poke-Collect's per-printing buylist endpoint quotes any exact printing, listed or not, so no
// merchant variant map is needed. English retail is Cardbit's own listing price (Card Broker keeps
// it equal to Poke-Collect retail); Japanese retail stays market plus the 20% markup, applied once.
async function verifyBuylist(
  refs: References,
  mapped: Map<string, string>,
  date: string,
  listed: Map<string, number>,
) {
  const pending = Object.values(refs).filter(
    (r) =>
      !mapped.has(r.key) &&
      (r.key.split("|")[1] === "ja" ? !!r.market : listed.has(r.key)),
  );
  let cursor = 0;
  async function worker() {
    while (cursor < pending.length) {
      const ref = pending[cursor++],
        id = ref.key.split("|")[0];
      const params = new URLSearchParams({
        tcgplayerId: id,
        printing: ref.finish,
        condition: ref.condition,
      });
      const reply = await fetch(
        "https://poke-collect.com/apps/buylist/singles/offer?" + params,
        {
          headers: { Accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(12000),
        },
      );
      if (!reply.ok)
        throw Error(
          "Poke-Collect could not verify the buylist. Retry the pricing refresh.",
        );
      const q = await reply.json();
      const cash = cents(q.cash);
      if (
        String(q.tcgplayerId) !== id ||
        q.setName !== ref.set ||
        q.number !== ref.number ||
        q.printing?.toLowerCase() !== ref.finish.toLowerCase() ||
        q.condition?.toLowerCase() !== ref.condition.toLowerCase() ||
        !cash ||
        q.unavailable ||
        q.hiddenBy
      )
        continue;
      const japanese = ref.key.split("|")[1] === "ja";
      if (!japanese) ref.retail = listed.get(ref.key)!;
      else ref.retail ??= Math.round((ref.market! * 120) / 100);
      ref.cash = cash;
      ref.retailDate = date;
      ref.quoteSource = "merchant";
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(6, pending.length) }, worker),
  );
}

export async function refresh(db: PrismaClient, admin: AdminApiContext) {
  const started = new Date(),
    today = started.toISOString().slice(0, 10);
  type Field = { jsonValue: unknown } | null;
  const { shop } = await gql<{
    shop: {
      myshopifyDomain: string;
      reference: Field;
      catalog: Field;
      links: Field;
    };
  }>(
    admin,
    `#graphql
    query WorkspacePriceInputs{shop{myshopifyDomain reference:metafield(namespace:"cardbit_staff_pricing",key:"reference_v1"){jsonValue}
      catalog:metafield(namespace:"cardbit_staff_pricing",key:"catalog_v1"){jsonValue}
      links:metafield(namespace:"cardbit_staff_pricing",key:"merchant_variants_v1"){jsonValue}}}`,
  );
  if (shop.myshopifyDomain !== CARDBIT_SHOP)
    throw Error("Wrong store for Cardbit pricing.");
  const feed =
    (shop.reference?.jsonValue as Feed | undefined) ??
    unpackCatalog(shop.catalog?.jsonValue);
  if (
    feed &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(feed.date) ||
      !Array.isArray(feed.cards) ||
      feed.cards.length > 20000 ||
      feed.cards.some(
        (r) =>
          !r ||
          ![r.id, r.name, r.set, r.finish, r.condition].every(
            (v) => typeof v === "string" && v.length > 0,
          ) ||
          [r.cash, r.retail].some(
            (n) =>
              n !== null &&
              (!Number.isSafeInteger(n) || n < 0 || n > 100000000),
          ),
      ))
  )
    throw Error("Invalid Cardbit planning price snapshot.");
  let linkSource = shop.links?.jsonValue;
  if (process.env.CARDBIT_MERCHANT_VARIANTS_FILE) {
    try {
      linkSource = JSON.parse(
        await readFile(process.env.CARDBIT_MERCHANT_VARIANTS_FILE, "utf8"),
      );
    } catch {
      throw Error("The private merchant variant map could not be read.");
    }
  }
  const links = merchantVariants(linkSource);
  const [old, stock] = await Promise.all([
    readBook(db),
    cardbitInventory(admin),
  ]);
  const identity = (r: InputRow) =>
    JSON.stringify([
      r.id,
      r.set,
      r.finish.toLowerCase(),
      r.condition.toLowerCase(),
      r.language?.toLowerCase() || "",
    ]);
  const rows = new Map<string, InputRow>();
  for (const ref of Object.values(old.refs)) {
    const r = {
      id: ref.key.split("|")[0],
      name: ref.name,
      no: ref.number,
      set: ref.set,
      finish: ref.finish,
      condition: ref.condition,
      language: ref.language,
      retail: null,
      cash: null,
    };
    rows.set(identity(r), r);
  }
  if (marketApproved()) {
    for (const r of await shopperJapanesePrintings(admin))
      rows.set(identity(r), r);
  }
  for (const v of stock) {
    const r = stockRow(v);
    rows.set(identity(r), r);
  }
  for (const r of feed?.cards ?? []) rows.set(identity(r), r);
  const matchKey = (id: string, finish: string, set: string) =>
    JSON.stringify([id, finish.toLowerCase(), set]);
  const catalog = new Map<string, Card[]>();
  const wanted = new Set([...rows.values()].map((r) => r.set));
  if (wanted.size) {
    for (const set of await pages<{ id: string; name: string }>("sets")) {
      if (!wanted.has(set.name)) continue;
      for (const c of await pages<Card>("cards", { setId: set.id })) {
        if (!c.set || !c.printing) continue;
        const match = matchKey(String(c.tcgplayerId), c.printing, c.set.name);
        catalog.set(match, [...(catalog.get(match) ?? []), c]);
      }
    }
  }
  const refs: References = {},
    variants: Record<string, string> = {};
  for (const r of rows.values()) {
    const hits = catalog
      .get(matchKey(r.id, r.finish, r.set))
      ?.filter(
        (c) =>
          !r.language ||
          printingKey(r.id, r.language, r.finish, r.condition) ===
            printingKey(r.id, c.language, r.finish, r.condition),
      );
    if (hits?.length !== 1) continue;
    const c = hits[0],
      key = printingKey(r.id, c.language, r.finish, r.condition);
    if (!key || (refs[key]?.retail != null && r.retail == null)) continue;
    const raw =
      marketApproved() && r.condition.toLowerCase() === "near mint"
        ? c.market
        : null;
    const market =
      raw?.market && /^\d+(\.\d{1,2})?$/.test(raw.market)
        ? cents(Number(raw.market))
        : null;
    refs[key] = {
      key,
      name: r.name,
      set: r.set,
      number: r.no,
      language: key.split("|")[1] === "ja" ? "Japanese" : "English",
      finish: r.finish,
      condition: r.condition,
      retail: r.retail,
      cash: r.cash,
      market,
      quoteSource: r.retail != null ? "snapshot" : "unmatched",
      retailDate: r.retail != null ? (feed?.date ?? "") : "",
      marketDate:
        market != null ? (raw?.marketAsOf ?? raw?.fetchedAt ?? null) : null,
    };
  }
  if (marketApproved()) {
    const japaneseRows = [...rows.values()].filter((r) => {
      const key = printingKey(r.id, r.language || "", r.finish, r.condition);
      return key?.endsWith("|near mint") && key.split("|")[1] === "ja";
    });
    const market = await japaneseSetMarkets(
      new Set(japaneseRows.map((r) => r.set)),
    );
    for (const row of japaneseRows) {
      const amount = market.get(
        setPrintingKey(row.set, row.id, row.no, row.finish),
      );
      const raw =
        amount && /^\d+(\.\d{1,2})?$/.test(amount)
          ? cents(Number(amount))
          : null;
      if (!raw) continue;
      const key = printingKey(row.id, "ja", row.finish, row.condition)!;
      refs[key] ??= {
        key,
        name: row.name,
        set: row.set,
        number: row.no,
        language: "Japanese",
        finish: row.finish,
        condition: row.condition,
        market: null,
        marketDate: null,
        retail: null,
        cash: null,
        quoteSource: "unmatched",
        retailDate: "",
      };
      refs[key].market = raw;
      refs[key].marketDate = today;
    }
  }
  // Only merchant-owned variant IDs from the explicit printing map go to the merchant.
  const mapped = Object.keys(refs).flatMap((k) =>
    links.has(k) ? [[k, links.get(k)!] as const] : [],
  );
  if (mapped.length) {
    const quotes = await fetchBuylistOffers(mapped.map(([, id]) => id));
    for (const [k, id] of mapped) {
      const q = quotes.get(id);
      if (!q)
        throw Error(
          "The merchant returned an incomplete quote batch. Retry the refresh.",
        );
      const r = refs[k];
      r.quoteSource = "merchant";
      r.retail = cents(q.retail);
      r.cash = q.hiddenBy || q.unavailable ? null : cents(q.cash);
      r.retailDate = today;
    }
  }
  const listed = new Map<string, number>();
  for (const v of stock) {
    const key = printingKey(
      v.card.tcgplayerId,
      v.card.language,
      v.card.printing,
      v.condition,
    );
    if (key && v.price && key.split("|")[1] !== "ja") listed.set(key, v.price);
  }
  await verifyBuylist(refs, links, today, listed);
  for (const v of stock) {
    const key = printingKey(
      v.card.tcgplayerId,
      v.card.language,
      v.card.printing,
      v.condition,
    );
    if (key && refs[key]) variants[v.variantId] = key;
  }
  if (rows.size && !Object.keys(refs).length)
    throw Error("No exact printings matched the Cardbit catalog.");
  await changeBook(db, {
    refs,
    variants,
    date: mapped.length ? today : (feed?.date ?? today),
    started,
  });
}
export async function candidates(
  db: PrismaClient,
  admin: AdminApiContext,
  r: Recipe,
): Promise<Stock[]> {
  const book = await readBook(db);
  if (!book.refreshed)
    throw Error("Refresh Cardbit pricing before matching available singles.");
  const stock = await cardbitInventory(admin),
    linked = new Set(
      stock
        .filter(
          (v) =>
            printingKey(
              v.card.tcgplayerId,
              v.card.language,
              v.card.printing,
              v.condition,
            ) === book.variants[v.variantId],
        )
        .map((v) => v.variantId),
    );
  const rows = await fetchCandidates(admin, {
    productType: "Pokemon Single, Pokemon Japanese Single",
    language: "",
    condition: r.condition,
  });
  return rows.flatMap((item) => {
    const ref = book.refs[book.variants[item.variantId]];
    return ref?.quoteSource === "merchant" && linked.has(item.variantId)
      ? [{ ...item, ...ref, image: item.imageUrl }]
      : [];
  });
}
