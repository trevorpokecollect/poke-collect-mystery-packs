import { parseLocalDateTime } from "./time";
import type { CampaignSettings } from "./settings";

// Pure helpers for the daily draw: which "day" a moment belongs to, and prize picking.
// A day runs from one draw to the next, e.g. 9pm ET to 9pm ET, and is named after the
// local date of the draw that closes it.

export type DailySettings = CampaignSettings["daily"];

export interface Period {
  key: string;
  opensAt: Date;
  drawAt: Date;
}

function localDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDays(ymd: string, days: number) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const drawOn = (ymd: string, drawTime: string, timeZone: string) =>
  parseLocalDateTime(`${ymd}T${drawTime}`, timeZone) as Date;

/** The daily period named `key` (the local date of its draw). */
export function periodForKey(
  key: string,
  timeZone: string,
  drawTime: string,
): Period {
  return {
    key,
    opensAt: drawOn(addDays(key, -1), drawTime, timeZone),
    drawAt: drawOn(key, drawTime, timeZone),
  };
}

/** The daily period containing `now`. */
export function periodFor(
  now: Date,
  timeZone: string,
  drawTime: string,
): Period {
  let key = localDate(now, timeZone);
  let drawAt = drawOn(key, drawTime, timeZone);
  if (now.getTime() >= drawAt.getTime()) {
    key = addDays(key, 1);
    drawAt = drawOn(key, drawTime, timeZone);
  }
  return { key, opensAt: drawOn(addDays(key, -1), drawTime, timeZone), drawAt };
}

export interface Candidate {
  variantId: string;
  productId: string;
  productHandle: string | null;
  productType: string;
  tags: string[];
  title: string;
  imageUrl: string | null;
  value: number;
  inventoryItemId: string;
  locationId: string;
  /** Copies in `source` at that location. */
  available: number;
  /** Where the reserved unit comes from (and goes back to if released). */
  source: StockSource;
}

export type StockSource = "available" | "safety_stock";

const languageTags = (languages: string) =>
  languages
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean)
    .map((l) => `language_${l}`);

/** Whether a variant fits the daily rules (type/language source and price range). */
export function eligible(c: Candidate, cfg: DailySettings) {
  if (c.available < 1) return false;
  if (c.value < cfg.minPrice || c.value > cfg.maxPrice) return false;
  return cfg.sources.some((s) => {
    if (
      s.productType.trim().toLowerCase() !== c.productType.trim().toLowerCase()
    )
      return false;
    const tags = languageTags(s.languages);
    return (
      tags.length === 0 ||
      c.tags.some((t) => tags.includes(t.trim().toLowerCase()))
    );
  });
}

/**
 * Picks one prize at random from the eligible candidates, skipping products used
 * recently. Falls back to recently used ones rather than having no prize at all.
 * `random` returns [0, 1).
 */
export function pickPrize(
  candidates: Candidate[],
  cfg: DailySettings,
  recentProductIds: Set<string>,
  random: () => number,
) {
  const pool = candidates.filter((c) => eligible(c, cfg));
  const fresh = pool.filter((c) => !recentProductIds.has(c.productId));
  const from = fresh.length ? fresh : pool;
  if (!from.length) return null;
  return from[Math.floor(random() * from.length)];
}

/** Product types to search Shopify for. */
export const sourceTypes = (cfg: DailySettings) => [
  ...new Set(cfg.sources.map((s) => s.productType.trim()).filter(Boolean)),
];

export interface QueueSlot {
  id: string;
  pinnedDate: string | null;
}

/**
 * Which queued item is planned for each of `days` days starting at `fromKey`: the item pinned
 * to that day, else the next unpinned one in order. Pins on days already past count as unpinned.
 */
export function planQueue<T extends QueueSlot>(
  items: T[],
  fromKey: string,
  days: number,
): { date: string; item: T | null }[] {
  const pinned = new Map<string, T>();
  const loose: T[] = [];
  for (const i of items) {
    if (i.pinnedDate && i.pinnedDate >= fromKey && !pinned.has(i.pinnedDate))
      pinned.set(i.pinnedDate, i);
    else loose.push(i);
  }
  const out: { date: string; item: T | null }[] = [];
  for (let d = 0; d < days; d++) {
    const date = addDays(fromKey, d);
    out.push({ date, item: pinned.get(date) ?? loose.shift() ?? null });
  }
  return out;
}
