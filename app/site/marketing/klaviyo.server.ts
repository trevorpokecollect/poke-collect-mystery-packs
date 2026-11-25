// Klaviyo for the standalone site (cardbit.com). Trevor, Nov 25: rebuild the Shopify-era Cardbit emails on the
// new site. The site sends Klaviyo two things:
//   1. Marketing consent (email / text) from SiteMarketing, so Klaviyo's Email List and welcome flow work.
//   2. Events that the flows trigger on (see METRICS). Rows go into SiteKlaviyoEvent first (deduplicated),
//      then a 5-minute clock sends them.
// Off unless KLAVIYO_PRIVATE_KEY is set on app-site. The key must belong to Cardbit's Klaviyo account: the
// account name is checked before anything is sent, so a Poke-Collect key can never receive Cardbit data.
// Only customers who currently have marketing consent get events. Transactional email stays on Resend.

import { createHash } from "node:crypto";
import type { PrismaClient, SiteCustomer, SiteMarketing } from "@prisma/client";

export const METRICS = {
  viewed: "Viewed Item", // R01 Browse Reminder
  shortfall: "Not Enough Cardbits", // R02 (was Saved Cart; Trevor chose this Nov 25)
  topupStarted: "Started Cardbits Top-Up", // R03 / R04 checkout reminders
  toppedUp: "Topped Up Cardbits", // conversion filter for R03 / R04
  opened: "Opened Pack", // conversion filter for W05, audience for R05
  restocked: "Pack Restocked", // R05 Pack Edition Restock
  backInStock: "Wanted Card Back In Stock", // R06 Exact Single Restock
} as const;

const API = "https://a.klaviyo.com/api";
const REVISION = "2024-10-15";
const LOOKBACK_MS = 48 * 3600_000;
const MAX_ATTEMPTS = 8;

type Env = NodeJS.ProcessEnv;
export type Fetch = typeof fetch;
export type KlaviyoDeps = { db: PrismaClient; env?: Env; fetch?: Fetch; now?: () => Date };

export function klaviyoConfig(env: Env = process.env) {
  const key = (env.KLAVIYO_PRIVATE_KEY || "").trim();
  if (!key || env.KLAVIYO_SYNC === "off") return null;
  return {
    key,
    emailListId: (env.KLAVIYO_EMAIL_LIST_ID || "").trim() || null,
    smsListId: (env.KLAVIYO_SMS_LIST_ID || "").trim() || null,
    accountName: (env.KLAVIYO_ACCOUNT_NAME || "Cardbit").trim().toLowerCase(),
    origin: (env.SITE_ORIGIN || env.CARDBIT_SITE_URL || "https://cardbit.com").replace(/\/+$/, ""),
  };
}
type Config = NonNullable<ReturnType<typeof klaviyoConfig>>;

const headers = (cfg: Config) => ({
  Authorization: `Klaviyo-API-Key ${cfg.key}`,
  revision: REVISION,
  accept: "application/vnd.api+json",
  "content-type": "application/vnd.api+json",
});

class KlaviyoHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call(deps: KlaviyoDeps, cfg: Config, method: string, path: string, body?: unknown) {
  const res = await (deps.fetch ?? fetch)(`${API}${path}`, { method, headers: headers(cfg), body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new KlaviyoHttpError(res.status, `Klaviyo ${method} ${path} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ---- account guard ---------------------------------------------------------------------------

let verified: { keyHash: string; ok: boolean; name: string } | null = null;
const hashKey = (k: string) => createHash("sha256").update(k).digest("hex");

/** True only when the key's Klaviyo account name contains KLAVIYO_ACCOUNT_NAME (default "Cardbit"). */
export async function verifyAccount(deps: KlaviyoDeps, cfg: Config) {
  const keyHash = hashKey(cfg.key);
  if (verified?.keyHash === keyHash) return verified;
  const res = await call(deps, cfg, "GET", "/accounts");
  const a = res?.data?.[0]?.attributes;
  const name = String(a?.contact_information?.organization_name || a?.contact_information?.default_sender_name || "");
  verified = { keyHash, ok: name.toLowerCase().includes(cfg.accountName), name };
  if (!verified.ok) console.error(`[site-klaviyo] key belongs to "${name}", not ${cfg.accountName}; nothing will be sent.`);
  return verified;
}
export const resetKlaviyoAccountCheck = () => {
  verified = null;
};

// ---- consent ---------------------------------------------------------------------------------

const emailOn = (m: Pick<SiteMarketing, "emailOptInAt" | "emailOptOutAt">) => !!m.emailOptInAt && (!m.emailOptOutAt || m.emailOptOutAt < m.emailOptInAt);
const smsOn = (m: Pick<SiteMarketing, "smsConfirmedAt" | "smsOptOutAt" | "smsPhone">) =>
  !!m.smsPhone && !!m.smsConfirmedAt && (!m.smsOptOutAt || m.smsOptOutAt < m.smsConfirmedAt);

/** Pushes changed consent rows (syncedAt null) to Klaviyo, then marks them synced. */
export async function syncConsent(deps: KlaviyoDeps, cfg: Config, limit = 100) {
  const now = deps.now?.() ?? new Date();
  const rows = await deps.db.siteMarketing.findMany({ where: { syncedAt: null }, orderBy: { updatedAt: "asc" }, take: limit });
  if (!rows.length) return { synced: 0 };
  const customers = new Map((await deps.db.siteCustomer.findMany({ where: { id: { in: rows.map((r) => r.customerId) } } })).map((c) => [c.id, c]));
  const subEmail: object[] = [], subSms: object[] = [], unsubEmail: object[] = [], unsubSms: object[] = [];
  const done: string[] = [];
  for (const m of rows) {
    const c = customers.get(m.customerId);
    done.push(m.customerId);
    if (!c || c.signupMethod === "demo") continue;
    const base = { email: c.email };
    if (emailOn(m) && !c.closedAt)
      subEmail.push({ type: "profile", attributes: { ...base, subscriptions: { email: { marketing: { consent: "SUBSCRIBED", consented_at: m.emailOptInAt!.toISOString() } } } } });
    else if (m.emailOptOutAt || c.closedAt) unsubEmail.push({ type: "profile", attributes: { ...base, subscriptions: { email: { marketing: { consent: "UNSUBSCRIBED" } } } } });
    if (cfg.smsListId && m.smsPhone) {
      const phone = { ...base, phone_number: m.smsPhone };
      if (smsOn(m) && !c.closedAt)
        subSms.push({ type: "profile", attributes: { ...phone, subscriptions: { sms: { marketing: { consent: "SUBSCRIBED", consented_at: m.smsConfirmedAt!.toISOString() } } } } });
      else if (m.smsOptOutAt || c.closedAt) unsubSms.push({ type: "profile", attributes: { ...phone, subscriptions: { sms: { marketing: { consent: "UNSUBSCRIBED" } } } } });
    }
  }
  const job = (type: string, profiles: object[], listId: string | null) => ({
    data: {
      type,
      attributes: { ...(type.includes("create") ? { custom_source: "cardbit.com", historical_import: false } : {}), profiles: { data: profiles } },
      ...(listId ? { relationships: { list: { data: { type: "list", id: listId } } } } : {}),
    },
  });
  if (subEmail.length) await call(deps, cfg, "POST", "/profile-subscription-bulk-create-jobs", job("profile-subscription-bulk-create-job", subEmail, cfg.emailListId));
  if (subSms.length) await call(deps, cfg, "POST", "/profile-subscription-bulk-create-jobs", job("profile-subscription-bulk-create-job", subSms, cfg.smsListId));
  // Opt-outs unsubscribe the channel account-wide (no list), so no Cardbit marketing reaches them.
  if (unsubEmail.length) await call(deps, cfg, "POST", "/profile-subscription-bulk-delete-jobs", job("profile-subscription-bulk-delete-job", unsubEmail, null));
  if (unsubSms.length) await call(deps, cfg, "POST", "/profile-subscription-bulk-delete-jobs", job("profile-subscription-bulk-delete-job", unsubSms, null));
  // Only rows not changed again while we were sending.
  await deps.db.siteMarketing.updateMany({ where: { customerId: { in: done }, syncedAt: null, updatedAt: { lte: rows.reduce((a, r) => (r.updatedAt > a ? r.updatedAt : a), rows[0].updatedAt) } }, data: { syncedAt: now } });
  return { synced: done.length, subscribed: subEmail.length + subSms.length, unsubscribed: unsubEmail.length + unsubSms.length };
}

// ---- event outbox ----------------------------------------------------------------------------

type NewEvent = { dedupeKey: string; customerId: string; metric: string; properties: Record<string, unknown>; value?: number | null; time: Date };

/** Customers allowed to receive marketing events: email or confirmed text consent, account open, not demo. */
async function marketable(db: PrismaClient, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Set<string>();
  const [rows, customers] = await Promise.all([
    db.siteMarketing.findMany({ where: { customerId: { in: unique } } }),
    db.siteCustomer.findMany({ where: { id: { in: unique }, closedAt: null, frozenAt: null }, select: { id: true, signupMethod: true } }),
  ]);
  const open = new Set(customers.filter((c) => c.signupMethod !== "demo").map((c) => c.id));
  return new Set(rows.filter((m) => open.has(m.customerId) && (emailOn(m) || smsOn(m))).map((m) => m.customerId));
}

async function insert(db: PrismaClient, events: NewEvent[]) {
  if (!events.length) return 0;
  const ok = await marketable(db, events.map((e) => e.customerId));
  const data = events
    .filter((e) => ok.has(e.customerId))
    .map((e) => ({ dedupeKey: e.dedupeKey.slice(0, 190), customerId: e.customerId, metric: e.metric, properties: e.properties as object, value: e.value ?? null, time: e.time }));
  if (!data.length) return 0;
  return (await db.siteKlaviyoEvent.createMany({ data, skipDuplicates: true })).count;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const singleKeyOf = (printingKey: string, condition: string) =>
  "s_" + createHash("sha256").update(`${printingKey}|${condition}`).digest("hex").slice(0, 20);
const cardProps = (origin: string, c: { printingKey: string; condition: string; title: string; name: string; setName: string; number: string; finish: string; language: string; image: string | null }) => ({
  item_type: "single",
  item_name: c.title || c.name,
  item_url: `${origin}/shop/${singleKeyOf(c.printingKey, c.condition)}`,
  item_image_url: c.image,
  printing_key: c.printingKey,
  set_name: c.setName,
  number: c.number,
  printing_display: c.finish,
  finish_display: c.finish,
  language_display: c.language,
  condition_display: c.condition,
});
const packProps = (origin: string, p: { id: string; title: string }) => ({
  item_type: "pack",
  item_name: p.title,
  edition_name: p.title,
  edition_key: p.id,
  item_url: `${origin}/packs/${p.id}`,
  item_image_url: null,
});

/** Called from the store when a pack or single purchase fails for lack of Cardbits (R02). */
export async function noteShortfall(db: PrismaClient, customer: Pick<SiteCustomer, "id">, action: { action: string; id?: string | null }, env: Env = process.env, now = new Date()) {
  const cfg = klaviyoConfig(env);
  if (!cfg || !action.id) return 0;
  const base = { topup_url: `${cfg.origin}/cardbits`, cart_url: `${cfg.origin}/cardbits` };
  let props: Record<string, unknown> | null = null;
  if (action.action === "open") {
    const p = await db.sitePack.findUnique({ where: { id: action.id }, select: { id: true, title: true, priceBits: true } });
    if (p) props = { ...packProps(cfg.origin, p), needed_cardbits: p.priceBits };
  } else if (action.action === "buy") {
    const forSale = await db.siteCopy.findMany({ where: { status: "FOR_SALE", demo: false } });
    const c = forSale.find((x) => singleKeyOf(x.printingKey, x.condition) === action.id);
    if (c) props = cardProps(cfg.origin, c);
  }
  if (!props) props = { item_type: action.action === "open" ? "pack" : "single", item_name: null, item_url: `${cfg.origin}/${action.action === "open" ? "packs" : "shop"}/${action.id}` };
  return insert(db, [{ dedupeKey: `shortfall:${customer.id}:${action.id}:${day(now)}`, customerId: customer.id, metric: METRICS.shortfall, properties: { ...base, ...props }, time: now }]);
}

/** Scans recent site activity and queues events. Idempotent: every event has a fixed dedupeKey. */
export async function collectEvents(deps: KlaviyoDeps, cfg: Config) {
  const db = deps.db;
  const now = deps.now?.() ?? new Date();
  const since = new Date(now.getTime() - LOOKBACK_MS);
  const events: NewEvent[] = [];

  // Top-ups: started (R03/R04 trigger) and credited (their conversion filter).
  const topups = await db.siteTopup.findMany({ where: { createdAt: { gte: since } }, select: { id: true, customerId: true, baseBits: true, bonusBits: true, cents: true, status: true, createdAt: true, updatedAt: true } });
  for (const t of topups) {
    const props = { cardbits: t.baseBits + t.bonusBits, base_cardbits: t.baseBits, bonus_cardbits: t.bonusBits, amount_display: `$${(t.cents / 100).toFixed(2)}`, checkout_url: `${cfg.origin}/cardbits`, topup_id: t.id };
    events.push({ dedupeKey: `topup-started:${t.id}`, customerId: t.customerId, metric: METRICS.topupStarted, properties: props, value: t.cents / 100, time: t.createdAt });
    if (t.status !== "PENDING") events.push({ dedupeKey: `topup-credited:${t.id}`, customerId: t.customerId, metric: METRICS.toppedUp, properties: props, value: t.cents / 100, time: t.updatedAt });
  }

  // Pack openings (paid only).
  const openings = await db.siteOpening.findMany({ where: { createdAt: { gte: since }, demo: false }, select: { id: true, customerId: true, packId: true, priceBits: true, createdAt: true } });
  const packIds = new Set(openings.map((o) => o.packId));

  // Manual restocks going live (hourly automatic buyback restocks are skipped so nobody gets an email every hour).
  const restocks = await db.siteRestock.findMany({ where: { status: "LIVE", auto: false, liveAt: { gte: since } }, select: { id: true, packId: true, version: true, liveAt: true } });
  for (const r of restocks) packIds.add(r.packId);

  // Browse: signed-in page views of a pack or a single.
  const views = await db.sitePageView.findMany({ where: { createdAt: { gte: since }, OR: [{ path: { startsWith: "/packs/" } }, { path: { startsWith: "/shop/" } }] }, select: { visitId: true, path: true, createdAt: true } });
  const visits = views.length ? await db.siteVisit.findMany({ where: { id: { in: [...new Set(views.map((v) => v.visitId))] }, customerId: { not: null }, staff: false }, select: { id: true, customerId: true } }) : [];
  const visitCustomer = new Map(visits.map((v) => [v.id, v.customerId!]));
  for (const v of views) if (v.path.startsWith("/packs/")) packIds.add(v.path.split("/")[2] || "");

  const packs = new Map((await db.sitePack.findMany({ where: { id: { in: [...packIds].filter(Boolean) } }, select: { id: true, title: true, active: true } })).map((p) => [p.id, p]));
  for (const o of openings) {
    const p = packs.get(o.packId);
    events.push({ dedupeKey: `opened:${o.id}`, customerId: o.customerId, metric: METRICS.opened, properties: { ...(p ? packProps(cfg.origin, p) : { edition_key: o.packId }), cardbits: o.priceBits }, time: o.createdAt });
  }

  const shopViews = views.filter((v) => v.path.startsWith("/shop/") && visitCustomer.has(v.visitId));
  const singles = new Map<string, Parameters<typeof cardProps>[1]>();
  if (shopViews.length) {
    const forSale = await db.siteCopy.findMany({ where: { status: "FOR_SALE", demo: false }, select: { printingKey: true, condition: true, title: true, name: true, setName: true, number: true, finish: true, language: true, image: true } });
    for (const c of forSale) singles.set(singleKeyOf(c.printingKey, c.condition), c);
  }
  for (const v of views) {
    const customerId = visitCustomer.get(v.visitId);
    if (!customerId) continue;
    const [, kind, id] = v.path.split("/");
    if (!id) continue;
    let props: Record<string, unknown> | null = null;
    if (kind === "packs") {
      const p = packs.get(id);
      if (p?.active) props = packProps(cfg.origin, p);
    } else {
      const c = singles.get(id);
      if (c) props = cardProps(cfg.origin, c);
    }
    if (props) events.push({ dedupeKey: `viewed:${customerId}:${kind}:${id}:${day(v.createdAt)}`, customerId, metric: METRICS.viewed, properties: props, time: v.createdAt });
  }

  // R05: a manual restock went live → everyone who opened that pack before.
  for (const r of restocks) {
    const p = packs.get(r.packId);
    if (!p?.active) continue;
    const openers = await db.siteOpening.findMany({ where: { packId: r.packId, demo: false }, distinct: ["customerId"], select: { customerId: true } });
    for (const o of openers)
      events.push({ dedupeKey: `restocked:${r.id}:${o.customerId}`, customerId: o.customerId, metric: METRICS.restocked, properties: { ...packProps(cfg.origin, p), restock_version: r.version }, time: r.liveAt! });
  }

  // R06: a printing on someone's Wants list was listed for sale.
  const listed = await db.siteCopyEvent.findMany({ where: { toStatus: "FOR_SALE", createdAt: { gte: since } }, select: { copyId: true, createdAt: true } });
  if (listed.length) {
    const copies = await db.siteCopy.findMany({ where: { id: { in: [...new Set(listed.map((l) => l.copyId))] }, status: "FOR_SALE", demo: false } });
    const byPrinting = new Map<string, (typeof copies)[number]>();
    for (const c of copies) if (!byPrinting.has(c.printingKey)) byPrinting.set(c.printingKey, c);
    const at = new Map(listed.map((l) => [l.copyId, l.createdAt]));
    if (byPrinting.size) {
      const wants = await db.siteWant.findMany({ where: { cardKey: { in: [...byPrinting.keys()] } } });
      for (const w of wants) {
        const c = byPrinting.get(w.cardKey)!;
        const t = at.get(c.id) ?? now;
        events.push({ dedupeKey: `want-instock:${w.customerId}:${w.cardKey}:${day(t)}`, customerId: w.customerId, metric: METRICS.backInStock, properties: cardProps(cfg.origin, c), time: t });
      }
    }
  }

  return insert(db, events);
}

/** Sends queued events (oldest first). 429/5xx retry with backoff; other 4xx are rejected. */
export async function sendEvents(deps: KlaviyoDeps, cfg: Config, limit = 200) {
  const db = deps.db;
  const now = deps.now?.() ?? new Date();
  const rows = await db.siteKlaviyoEvent.findMany({ where: { status: { in: ["PENDING", "FAILED"] }, nextAt: { lte: now } }, orderBy: { createdAt: "asc" }, take: limit });
  if (!rows.length) return { sent: 0, failed: 0 };
  const customers = new Map((await db.siteCustomer.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.customerId))] } } })).map((c) => [c.id, c]));
  const ok = await marketable(db, rows.map((r) => r.customerId));
  let sent = 0, failed = 0;
  for (const r of rows) {
    const c = customers.get(r.customerId);
    if (!c || !ok.has(r.customerId)) {
      await db.siteKlaviyoEvent.update({ where: { id: r.id }, data: { status: "SKIPPED", error: "no marketing consent" } });
      continue;
    }
    const claim = await db.siteKlaviyoEvent.updateMany({ where: { id: r.id, attempts: r.attempts, status: r.status }, data: { attempts: { increment: 1 } } });
    if (claim.count !== 1) continue;
    const firstName = (c.name || "").trim().split(/\s+/)[0] || undefined;
    try {
      await call(deps, cfg, "POST", "/events", {
        data: {
          type: "event",
          attributes: {
            properties: r.properties,
            time: r.time.toISOString(),
            unique_id: r.dedupeKey,
            ...(r.value != null ? { value: r.value, value_currency: "USD" } : {}),
            metric: { data: { type: "metric", attributes: { name: r.metric } } },
            profile: { data: { type: "profile", attributes: { email: c.email, external_id: c.id, ...(firstName ? { first_name: firstName } : {}) } } },
          },
        },
      });
      await db.siteKlaviyoEvent.update({ where: { id: r.id }, data: { status: "SENT", sentAt: new Date(), error: null } });
      sent++;
    } catch (e) {
      const status = e instanceof KlaviyoHttpError ? e.status : 0;
      const retry = (status === 0 || status === 429 || status >= 500) && r.attempts + 1 < MAX_ATTEMPTS;
      await db.siteKlaviyoEvent.update({
        where: { id: r.id },
        data: { status: retry ? "FAILED" : "REJECTED", error: (e as Error).message.slice(0, 500), nextAt: new Date(now.getTime() + 2 ** (r.attempts + 1) * 60_000) },
      });
      failed++;
    }
  }
  return { sent, failed };
}

/** One pass: account check, consent sync, collect, send. Safe to run any time; no-op without the key. */
export async function runKlaviyoSync(deps: KlaviyoDeps) {
  const cfg = klaviyoConfig(deps.env);
  if (!cfg) return { enabled: false as const };
  const account = await verifyAccount(deps, cfg);
  if (!account.ok) return { enabled: false as const, reason: "wrong_account", account: account.name };
  const consent = await syncConsent(deps, cfg);
  const queued = await collectEvents(deps, cfg);
  const sent = await sendEvents(deps, cfg);
  return { enabled: true as const, consent, queued, ...sent };
}

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
/** Every 5 minutes on app-site in production when KLAVIYO_PRIVATE_KEY is set. KLAVIYO_SYNC=off stops it. */
export function startKlaviyoClock(db: PrismaClient) {
  if (timer || process.env.CARDBIT_SITE !== "on" || process.env.NODE_ENV !== "production" || !klaviyoConfig()) return;
  const tick = () => {
    if (running) return;
    running = true;
    void runKlaviyoSync({ db })
      .catch((e) => console.error("[site-klaviyo] sync failed", (e as Error).message))
      .finally(() => {
        running = false;
      });
  };
  timer = setInterval(tick, 5 * 60_000);
  timer.unref();
}
