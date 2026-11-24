import {
  buildWithLimits,
  normalizeTierRules,
  tierFor,
  type TierRule,
} from "../lib/pool-builder";

export const editions = [
  "mystery",
  "booster",
  "japanese",
  "gold",
  "wildcard",
] as const;
export type Edition = (typeof editions)[number];
export const cardsPerPack = (e: Edition) => (e === "booster" ? 5 : 1);
export type Reference = {
  key: string;
  name: string;
  set: string;
  number: string;
  language: string;
  finish: string;
  condition: string;
  retail: number | null;
  cash: number | null;
  market: number | null;
  quoteSource?: "merchant" | "snapshot" | "unmatched";
  retailDate: string;
  marketDate: string | null;
};
export type Stock = Reference & {
  variantId: string;
  productId: string;
  inventoryItemId: string;
  locationId: string;
  available: number;
  image: string | null;
};
export type Band = {
  set: string;
  min: number;
  max: number | null;
  rate: number;
};
export type Policy = {
  basis?: "retail" | "market";
  rate: number;
  bands: Band[];
  overrides: Record<string, number>;
};
export const initialPolicy: Policy = { rate: 8000, bands: [], overrides: {} };
export const isInt = (n: unknown, min: number, max: number): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;
export function validatePolicy(p: Policy) {
  if (
    !p ||
    (p.basis !== undefined && !["retail", "market"].includes(p.basis)) ||
    !isInt(p.rate, 0, 10000) ||
    !Array.isArray(p.bands) ||
    p.bands.length > 60 ||
    !p.overrides ||
    typeof p.overrides !== "object" ||
    Array.isArray(p.overrides) ||
    Object.keys(p.overrides).length > 10000 ||
    Object.entries(p.overrides).some(
      ([k, v]) => !k.includes("|") || k.length > 240 || !isInt(v, 0, 10000),
    )
  )
    throw Error("Enter a rate from 0 to 100%.");
  for (const b of p.bands)
    if (
      !b ||
      typeof b.set !== "string" ||
      b.set.length > 200 ||
      !isInt(b.min, 0, 100000000) ||
      (b.max !== null && !isInt(b.max, b.min + 1, 100000000)) ||
      !isInt(b.rate, 0, 10000)
    )
      throw Error("Check each range and its rate.");
}
function isJapanese(c: Reference) {
  const language = c.key?.split("|")[1] || c.language;
  return ["ja", "jp", "japanese"].includes(String(language).trim().toLowerCase());
}

// Pool economics and Cardbits use the exact Japanese printing's USD market quote.
export function poolRetail(c: Reference): number | null {
  if (!isJapanese(c)) return c.retail;
  if (!c.retail || !c.market || !Number.isSafeInteger(c.market) || c.market < 0) return null;
  return Math.round(c.market * 120 / 100);
}

export function offer(c: Reference, p: Policy): number | null {
  if (c.quoteSource && c.quoteSource !== "merchant") return null;
  if (c.cash == null || c.cash <= 0 || c.retail == null || c.retail <= 0)
    return null;
  const retail = poolRetail(c);
  if (retail == null) return null;
  if (isJapanese(c)) return Math.round(retail * 80 / 100) || null;
  const band = p.bands.find(
    (b) =>
      (!b.set || b.set === c.set) &&
      retail >= b.min &&
      (b.max == null || retail < b.max),
  );
  const bps = p.overrides[c.key] ?? band?.rate ?? p.rate;
  const basis = p.basis === "market" ? c.market : retail;
  return basis == null
    ? null
    : Math.floor((basis * bps + 5000) / 10000) || null;
}
export function printingKey(
  id: unknown,
  language: string,
  finish: string,
  condition: string,
) {
  const languages: Record<string, string> = {
    english: "en",
    en: "en",
    jp: "ja",
    ja: "ja",
    japanese: "ja",
  };
  const lang =
    languages[
      String(language ?? "")
        .trim()
        .toLowerCase()
    ];
  if (
    !/^\d+$/.test(String(id)) ||
    !lang ||
    typeof finish !== "string" ||
    !finish.trim() ||
    typeof condition !== "string" ||
    !condition.trim()
  )
    return null;
  return [
    id,
    lang,
    finish.trim().toLowerCase(),
    condition.trim().toLowerCase(),
  ].join("|");
}
/** Prize pools hold real singles for the Daily Spinner tiers or the Spark Shop. They are never sold as packs. */
export const PRIZE_KINDS = ["spin-basic", "spin-silver", "spin-gold", "spin-cobalt", "spark-shop"] as const;
export type PrizeKind = (typeof PRIZE_KINDS)[number];
/** Spark Shop singles top out at 200 Cardbits of value (the 1,000-Spark tier). */
export const SPARK_SHOP_MAX = 200;
export const prizeVariant = (k: PrizeKind) => "cardbit-prize:" + k;
export type Recipe = {
  prize?: PrizeKind;
  edition: Edition;
  title: string;
  packs: number;
  price: number;
  language: string;
  set: string;
  condition: string;
  finish?: string;
  min: number;
  max: number;
  target: number;
  copies: number;
  minHits: number;
  hit: number;
  minBigHits?: number;
  bigHit?: number;
  minTopHits?: number;
  topHit?: number;
  fillerMax?: number;
  japaneseCap?: number;
  tiers: TierRule[];
};
export function validateRecipe(r: Recipe) {
  if (
    !r ||
    !editions.includes(r.edition) ||
    !r.title?.trim() ||
    r.title.length > 90 ||
    !isInt(r.packs, 1, Math.floor(1000 / cardsPerPack(r.edition))) ||
    !isInt(r.price, 1, 10000000) ||
    !isInt(r.target, 1, 100000) ||
    !isInt(r.min, 0, 9999999) ||
    !isInt(r.max, r.min + 1, 10000000) ||
    !isInt(r.copies, 1, 5) ||
    !isInt(r.minHits, 0, 1000) ||
    !isInt(r.hit, 0, 10000000) ||
    !["Any", "English", "Japanese"].includes(r.language) ||
    !["Near Mint", "Lightly Played", "Moderately Played"].includes(
      r.condition,
    ) ||
    typeof r.set !== "string" ||
    r.set.length > 200
  )
    throw Error("Check the pack count, price and inventory rules.");
  if (
    r.prize !== undefined &&
    (!PRIZE_KINDS.includes(r.prize) ||
      cardsPerPack(r.edition) !== 1 ||
      (r.prize === "spark-shop" && r.max > SPARK_SHOP_MAX))
  )
    throw Error(
      "Prize pools use one card per slot, and Spark Shop singles must be worth 200 Cardbits or less.",
    );
  if (
    [r.minBigHits, r.minTopHits].some(
      (n) => n !== undefined && !isInt(n, 0, 1000),
    ) ||
    [r.bigHit, r.topHit, r.fillerMax].some(
      (n) => n !== undefined && !isInt(n, 0, 10000000),
    ) ||
    (r.japaneseCap !== undefined && !isInt(r.japaneseCap, 0, 100))
  )
    throw Error("Check the additional hit floors and language limit.");
  if (
    !Array.isArray(r.tiers) ||
    r.tiers.length !== 5 ||
    r.tiers.some((t) => !t || t.name.length > 45 || !isInt(t.min, 0, 10000000))
  )
    throw Error(
      "Give each of the five tiers a distinct name and a minimum value.",
    );
  if (
    r.finish !== undefined &&
    (typeof r.finish !== "string" || r.finish.length > 64)
  )
    throw Error("Choose a printing finish.");
  const tiers = normalizeTierRules(r.tiers);
  if (tiers[0].min !== 0) throw Error("The first tier must start at zero.");
}
export function planPool(stock: Stock[], r: Recipe) {
  validateRecipe(r);
  const perPack = cardsPerPack(r.edition),
    count = r.packs * perPack;
  const eligible = stock.map(c => ({ ...c, retail: poolRetail(c) })).filter(
    (c) =>
      c.available > 0 &&
      c.cash &&
      c.cash > 0 &&
      c.retail &&
      c.retail > 0 &&
      (r.language === "Any" || c.language === r.language) &&
      (!r.set || c.set === r.set) &&
      (!r.finish ||
        (r.finish === "Except Normal"
          ? c.finish.toLowerCase() !== "normal"
          : c.finish === r.finish)) &&
      c.condition === r.condition,
  );
  const tiers = normalizeTierRules(r.tiers);
  const variants = new Map<string, Stock[]>();
  for (const c of eligible) {
    const list = variants.get(c.key) ?? [];
    list.push(c);
    variants.set(c.key, list);
  }
  const printings = [...variants].map(([key, rows]) => ({
    variantId: key,
    value: rows[0].retail! / 100,
    japanese: rows[0].language === "Japanese",
    available: rows.reduce((sum, c) => sum + c.available, 0),
  }));
  const picked = buildWithLimits(printings, {
    count,
    minValue: r.min / 100,
    maxValue: r.max / 100,
    targetAverage: (r.price * r.target) / 10000 / perPack / 100,
    maxCopies: r.copies,
    minHits: r.minHits,
    hitValue: r.hit / 100,
    minBigHits: r.minBigHits,
    bigHitValue: (r.bigHit ?? 0) / 100,
    minTopHits: r.minTopHits,
    topHitValue: (r.topHit ?? 0) / 100,
    fillerMax: (r.fillerMax ?? 0) / 100,
    maxJapanesePercent: r.japaneseCap,
  });
  return picked.cards.flatMap((p) => {
    let remaining = p.quantity;
    return variants.get(p.variantId)!.flatMap((c) => {
      const quantity = Math.min(remaining, c.available);
      remaining -= quantity;
      return quantity
        ? [{ ...c, tier: tierFor(c.retail!, tiers), quantity }]
        : [];
    });
  });
}
export type Planned = ReturnType<typeof planPool>[number];
export type Point = { at: string; bits: number | null; market: number | null };
export type Holding = Reference & {
  qty: number;
  bits: number | null;
  history: Point[];
};
export type Portfolio = {
  holdings: Holding[];
  history: Point[];
  count: number;
  priced: number;
  marked: number;
  bits: number | null;
  market: number | null;
  asOf: string;
};
export function portfolio(
  holdings: Holding[],
  history: Point[],
  at: string,
): Portfolio {
  const count = holdings.reduce((s, c) => s + c.qty, 0);
  const sum = (k: "bits" | "market") =>
    holdings.reduce((s, c) => s + (c[k] ?? 0) * c.qty, 0);
  const coverage = (k: "bits" | "market") =>
    holdings.reduce((s, c) => s + (c[k] == null ? 0 : c.qty), 0);
  const priced = coverage("bits"),
    marked = coverage("market");
  return {
    holdings,
    history,
    count,
    priced,
    marked,
    bits: priced || !count ? sum("bits") : null,
    market: marked || !count ? sum("market") : null,
    asOf: at,
  };
}
