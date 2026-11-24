import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { PrismaClient, Prisma } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { launchSeriesInTransaction } from "../lib/pool.server";
import { asJson, readBook, lockBook } from "./book.server";
import { lockPackVariantDraft } from "../lib/series-draft-lock.server";
import { liveWorkspace } from "./mode.server";
import { workspacePackProducts } from "./pack-products.server";
import { candidates } from "./sources.server";
import {
  planPool,
  poolRetail,
  validateRecipe,
  cardsPerPack,
  prizeVariant,
  type Stock,
  type Recipe,
} from "./model";

const prefix = "cb-workspace-";
const directPrefix = "cb-owner-";
export const seriesFilter = () =>
  liveWorkspace(shop)
    ? { shop, staffTest: false, handle: { startsWith: directPrefix } }
    : { shop, staffTest: true, handle: { startsWith: prefix } };
const recipeOf = (rules: Prisma.JsonValue) =>
  (rules &&
  typeof rules === "object" &&
  !Array.isArray(rules) &&
  "cardbitRecipe" in rules
    ? rules.cardbitRecipe
    : rules) as unknown as Recipe;
function nativeBuildRules(r: Recipe) {
  const per = cardsPerPack(r.edition);
  return {
    cardbitRecipe: r,
    cardbitSalesChannel: r.prize ? "prize" : "wallet",
    ...(r.prize === "spark-shop"
      ? { cardbitSparkShop: true }
      : r.prize
        ? { cardbitDailySpin: r.prize.slice("spin-".length) }
        : {}),
    productType: "Pokemon Single,Pokemon Japanese Single",
    language: r.language === "Any" ? "" : r.language,
    condition: r.condition,
    count: r.packs * per,
    minValue: r.min / 100,
    maxValue: r.max / 100,
    targetAverage: ((r.price / 100) * r.target) / 10000 / per,
    maxCopies: r.copies,
    minHits: r.minHits,
    hitValue: r.hit / 100,
    minBigHits: r.minBigHits ?? 0,
    bigHitValue: (r.bigHit ?? 0) / 100,
    minTopHits: r.minTopHits ?? 0,
    topHitValue: (r.topHit ?? 0) / 100,
    fillerMax: (r.fillerMax ?? 0) / 100,
    maxJapanesePercent: r.japaneseCap ?? 100,
  };
}
export const details = {
  cards: {
    select: {
      title: true,
      tier: true,
      quantity: true,
      marketValue: true,
      variantId: true,
      locationId: true,
      inventoryItemId: true,
    },
    orderBy: { sortOrder: "asc" as const },
  },
};
export type SeriesView = Prisma.SeriesGetPayload<{ include: typeof details }>;
export function draftRevision(s: SeriesView) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        s.id,
        s.title,
        s.packProductId,
        s.packVariantId,
        String(s.packPrice),
        s.cardsPerPack,
        s.buildRules,
        s.tierRules,
        s.reserveInventory,
        s.cards.map((c) => [
          c.variantId,
          c.inventoryItemId,
          c.locationId,
          c.quantity,
          c.tier,
          String(c.marketValue),
        ]),
      ]),
    )
    .digest("hex");
}
export function toView(s: SeriesView) {
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    recipe: recipeOf(s.buildRules),
    prize: recipeOf(s.buildRules)?.prize ?? null,
    commit: s.commitHash,
    revision: draftRevision(s),
    handle: s.handle,
    rows: s.cards.map((c) => ({
      name: c.title,
      tier: c.tier,
      quantity: c.quantity,
      retail: Math.round(Number(c.marketValue) * 100),
    })),
  };
}
export async function pools(db: PrismaClient) {
  return (
    await db.series.findMany({
      where: seriesFilter(),
      include: details,
      orderBy: { createdAt: "desc" },
    })
  )
    .filter((s) => recipeOf(s.buildRules)?.edition)
    .map(toView);
}
const lock = (tx: Prisma.TransactionClient) =>
  tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${shop + "/desk-pool"},0))::text`;
async function freeStock(
  tx: Prisma.TransactionClient,
  rows: Stock[],
  except?: string,
) {
  const busy = await tx.card.findMany({
    where: {
      series: {
        shop,
        status: { in: ["DRAFT", "LIVE"] },
        ...(liveWorkspace(shop) ? { staffTest: false } : {}),
        ...(except ? { id: { not: except } } : {}),
      },
    },
    select: {
      variantId: true,
      locationId: true,
      quantity: true,
      reservedQty: true,
    },
  });
  const used = new Map<string, number>();
  for (const c of busy) {
    const k = c.variantId + "/" + c.locationId;
    used.set(k, (used.get(k) ?? 0) + Math.max(0, c.quantity - c.reservedQty));
  }
  return rows.map((c) => ({
    ...c,
    available: Math.max(
      0,
      c.available - (used.get(c.variantId + "/" + c.locationId) ?? 0),
    ),
  }));
}
export async function build(
  db: PrismaClient,
  admin: AdminApiContext,
  r: Recipe,
  requestId: string,
) {
  validateRecipe(r);
  if (!/^[a-f0-9-]{36}$/i.test(requestId))
    throw Error("Reload the builder and try again.");
  const live = liveWorkspace(shop);
  const handle = (live ? directPrefix : prefix) + requestId;
  const existing = await db.series.findFirst({
    where: { ...seriesFilter(), handle },
    include: details,
  });
  if (existing) {
    if (!isDeepStrictEqual(recipeOf(existing.buildRules), r))
      throw Error("This request was already used for different pool rules.");
    return toView(existing);
  }
  const product = live && !r.prize
    ? (await workspacePackProducts(admin))[r.edition]
    : undefined;
  if (live && !r.prize && (!product || product.price !== r.price))
    throw Error(
      "The edition or its pack price changed in Shopify. Reload before saving the draft.",
    );
  const stock = await candidates(db, admin, r);
  return db.$transaction(async (tx) => {
    await lock(tx);
    const previous = await tx.series.findUnique({
      where: { shop_handle: { shop, handle } },
      include: details,
    });
    if (previous) {
      if (!isDeepStrictEqual(recipeOf(previous.buildRules), r))
        throw Error("This request was already used for different pool rules.");
      return toView(previous);
    }
    const boundVariant = r.prize ? prizeVariant(r.prize) : product?.variantId;
    if (boundVariant) {
      await lockPackVariantDraft(tx, shop, boundVariant);
      const other = await tx.series.findFirst({
        where: {
          shop,
          staffTest: false,
          packVariantId: boundVariant,
          status: "DRAFT",
        },
        select: { title: true },
      });
      if (other)
        throw Error(
          "This edition already has a draft: " +
            other.title +
            ". Open it under Current pools.",
        );
    }
    const rows = planPool(await freeStock(tx, stock), r);
    const series = await tx.series.create({
      data: {
        shop,
        staffTest: !live,
        reserveInventory: live,
        title: r.title.trim(),
        handle,
        status: "DRAFT",
        packVariantId: r.prize ? prizeVariant(r.prize) : (product?.variantId ?? "qa:" + handle),
        packProductId: r.prize ? "cardbit-prize" : (product?.productId ?? "qa:" + r.edition),
        packPrice: r.price / 100,
        autoOpenDays: 0,
        cardsPerPack: cardsPerPack(r.edition),
        tierRules: asJson(r.tiers.map((t) => ({ ...t, min: t.min / 100 }))),
        buildRules: asJson(live ? nativeBuildRules(r) : r),
        cards: {
          create: rows.map((c, i) => ({
            title: c.name,
            variantId: c.variantId,
            productId: c.productId,
            imageUrl: c.image,
            quantity: c.quantity,
            sortOrder: i,
            marketValue: c.retail! / 100,
            tier: c.tier,
            locationId: c.locationId,
            inventoryItemId: c.inventoryItemId,
          })),
        },
      },
      include: details,
    });
    return toView(series);
  });
}
export async function commitPool(
  db: PrismaClient,
  admin: AdminApiContext,
  id: string,
  revision?: string,
) {
  if (liveWorkspace(shop)) {
    if (!revision || !/^[a-f0-9]{64}$/.test(revision))
      throw Error("Review this draft in the owner workspace before launching.");
    const { launchWalletPool } = await import("./launch.server");
    return launchWalletPool(db, admin, id, revision);
  }
  const s = await db.series.findFirstOrThrow({
    where: { ...seriesFilter(), id },
    include: details,
  });
  if (s.commitHash) return toView(s);
  const stock = await candidates(db, admin, recipeOf(s.buildRules));
  return db.$transaction(async (tx) => {
    await lock(tx);
    const fresh = await tx.series.findFirstOrThrow({
      where: { ...seriesFilter(), id },
      include: details,
    });
    if (fresh.commitHash) return toView(fresh);
    await lockBook(tx);
    const currentBook = await readBook(tx);
    const free = new Map(
      (await freeStock(tx, stock, id)).map((c) => [c.variantId, c]),
    );
    for (const c of fresh.cards) {
      const current = free.get(c.variantId);
      const ref = currentBook.refs[currentBook.variants[c.variantId]];
      if (
        ref?.quoteSource !== "merchant" ||
        !ref.cash ||
        ref.key !== current?.key ||
        poolRetail(ref) !== Math.round(Number(c.marketValue) * 100) ||
        !current?.cash ||
        current.locationId !== c.locationId ||
        current.inventoryItemId !== c.inventoryItemId ||
        current.available < c.quantity ||
        poolRetail(current) !== Math.round(Number(c.marketValue) * 100)
      )
        throw Error(
          "Stock or pricing changed. Discard this draft and rebuild it.",
        );
    }
    await launchSeriesInTransaction(tx, id);
    return toView(
      await tx.series.findUniqueOrThrow({ where: { id }, include: details }),
    );
  });
}
export async function discard(db: PrismaClient, id: string) {
  return db.$transaction(async (tx) => {
    await lock(tx);
    const r = await tx.series.deleteMany({
      where: {
        ...seriesFilter(),
        id,
        status: "DRAFT",
        cards: { none: { reservedQty: { gt: 0 } } },
      },
    });
    if (!r.count)
      throw Error("Only a draft with no reserved stock can be discarded.");
  });
}

/** The native launch screen calls this immediately before the existing physical reservation and shuffle. */
export async function verifyWorkspaceLaunch(
  db: PrismaClient,
  admin: AdminApiContext,
  seriesId: string,
) {
  const pool = await db.series.findFirstOrThrow({
    where: { id: seriesId, ...seriesFilter(), status: "DRAFT" },
    include: details,
  });
  if (!pool.reserveInventory)
    throw Error("This Cardbit pool must reserve its physical singles.");
  const prize = recipeOf(pool.buildRules)?.prize;
  if (prize) {
    if (pool.packVariantId !== prizeVariant(prize) || pool.cardsPerPack !== 1)
      throw Error("This prize pool's binding changed. Review the draft before launch.");
  }
  const products = prize ? {} : await workspacePackProducts(admin);
  const bound = prize ? null : Object.values(products).find(
    (product) =>
      product.variantId === pool.packVariantId &&
      product.productId === pool.packProductId,
  );
  if (
    !prize && (!bound ||
    bound.price !== Math.round(Number(pool.packPrice) * 100) ||
    cardsPerPack(bound.edition) !== pool.cardsPerPack ||
    (recipeOf(pool.buildRules)?.price &&
      recipeOf(pool.buildRules).price !== bound.price))
  )
    throw Error(
      "The Cardbit pack product, price or pack size changed. Review the draft before launch.",
    );
  const book = await readBook(db);
  if (
    !pool.cards.length ||
    pool.cards.some((card) => {
      const ref = book.refs[book.variants[card.variantId]];
      return (
        !ref ||
        ref.quoteSource !== "merchant" ||
        !ref.cash ||
        poolRetail(ref) !== Math.round(Number(card.marketValue) * 100) ||
        !card.inventoryItemId ||
        !card.locationId
      );
    })
  )
    throw Error(
      "One or more singles needs a current merchant price and an inventory location. Refresh pricing and rebuild the draft.",
    );
}
