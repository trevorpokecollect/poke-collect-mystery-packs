// First-party visit tracking for cardbit.com (Card Broker's Analytics tab reads it).
// The page script (public/site/js/cardbit-site-pulse.js) posts {k:"view"|"ping", p, r} to /api/pulse.
// One SiteVisit per browsing session (30 idle minutes ends it), one SitePageView per page.
// Two random first-party cookies: cb_vid (visitor, 1 year) and cb_vs (current visit, 30 minutes).
// Nothing is sent to ad networks. Bots and staff are recorded apart or skipped.
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { cookieValue, currentCustomer } from "../core/auth.server";
import { staffEmails } from "../shipping/staff.server";
import { clientIp, defaultGeoLookup, isPrivateIp, type GeoLookup } from "../region.server";

export const VISITOR_COOKIE = "cb_vid";
export const VISIT_COOKIE = "cb_vs";
export const VISIT_IDLE_MS = 30 * 60_000;
const PING_WRITE_MS = 20_000;
const MAX_VIEWS_PER_VISIT = 500;
const ID_RE = /^[A-Za-z0-9_-]{16,40}$/;

// ---------- Classification ----------

const BOT_RE =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora link|whatsapp|telegram|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|axios|node-fetch|go-http|java\//i;
export const isBot = (ua: string) => !ua || BOT_RE.test(ua);

export function parseUserAgent(ua: string) {
  const device = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua) ? "tablet" : /Mobi|iPhone|iPod|Android/i.test(ua) ? "mobile" : "desktop";
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /FxiOS|Firefox\//.test(ua)
          ? "Firefox"
          : /CriOS|Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : /AppleWebKit/.test(ua)
                ? "App"
                : "Other";
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /CrOS/.test(ua)
        ? "ChromeOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "macOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "Other";
  return { device, browser, os };
}

const SEARCH: [RegExp, string][] = [
  [/(^|\.)google\./, "Google"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"],
  [/(^|\.)search\.yahoo\.com$|(^|\.)yahoo\.com$/, "Yahoo"],
  [/(^|\.)ecosia\.org$/, "Ecosia"],
  [/(^|\.)search\.brave\.com$/, "Brave"],
  [/(^|\.)baidu\.com$/, "Baidu"],
  [/(^|\.)yandex\./, "Yandex"],
];
const SOCIAL: [RegExp, string][] = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|m\.facebook\.com|l\.facebook\.com)$/, "Facebook"],
  [/(^|\.)(instagram\.com|l\.instagram\.com)$/, "Instagram"],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, "X"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)reddit\.com$/, "Reddit"],
  [/(^|\.)pinterest\./, "Pinterest"],
  [/(^|\.)threads\.(net|com)$/, "Threads"],
  [/(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/, "LinkedIn"],
  [/(^|\.)snapchat\.com$/, "Snapchat"],
  [/(^|\.)twitch\.tv$/, "Twitch"],
];
const DISCORD = /(^|\.)(discord\.com|discordapp\.com|discord\.gg)$/;
const MAIL = /(^|\.)(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|mail\.yahoo\.com|mail\.aol\.com|icloud\.com|klaviyo\.com|klclick\d?\.com)$/;

const named = (list: [RegExp, string][], host: string) => list.find(([re]) => re.test(host))?.[1] ?? null;

/** A name typed into utm_source ("ig", "Discord", "klaviyo") mapped onto the same channels as referrers. */
function utmChannel(src: string, medium: string): { source: string; sourceName: string } | null {
  const s = src.toLowerCase();
  const m = medium.toLowerCase();
  if (/^(cpc|ppc|paid|paidsocial|paid_social|paid-social|display|cpm|ads?)$/.test(m)) return { source: "paid", sourceName: src || "Paid" };
  if (/^(sms|text)$/.test(m) || /^(sms|text|attentive|postscript)$/.test(s)) return { source: "sms", sourceName: src || "SMS" };
  if (/^e-?mail$|newsletter/.test(m) || /klaviyo|e-?mail|newsletter|mailchimp/.test(s)) return { source: "email", sourceName: src || "Email" };
  if (/discord/.test(s)) return { source: "discord", sourceName: "Discord" };
  const social = [
    [/^(fb|facebook)$/, "Facebook"],
    [/^(ig|insta|instagram)$/, "Instagram"],
    [/^(x|twitter)$/, "X"],
    [/^(tt|tiktok)$/, "TikTok"],
    [/^(yt|youtube)$/, "YouTube"],
    [/^reddit$/, "Reddit"],
    [/^whatnot$/, "Whatnot"],
  ] as const;
  for (const [re, name] of social) if (re.test(s)) return { source: name === "Whatnot" ? "referral" : "social", sourceName: name };
  if (/^(social|social-media|socialmedia)$/.test(m)) return { source: "social", sourceName: src || "Social" };
  if (/^(google|bing)$/.test(s) && /^organic$/.test(m)) return { source: "search", sourceName: src };
  return src ? { source: "campaign", sourceName: src } : null;
}

export type Attribution = {
  referrerHost: string | null;
  source: string;
  sourceName: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
};

/** Where a visit came from: UTM tags first (they are deliberate), then the referring site, else direct. */
export function classifySource(referrer: string, landingSearch: string, ownHost: string): Attribution {
  let host: string | null = null;
  try {
    host = referrer ? new URL(referrer).hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch {
    host = null;
  }
  const own = ownHost.toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "");
  if (host && (host === own || host.endsWith("." + own) || host === "cardbit.com" || host.endsWith("up.railway.app"))) host = null;
  const q = new URLSearchParams(landingSearch);
  const clip = (v: string | null) => (v ? v.trim().slice(0, 80) || null : null);
  const utmSource = clip(q.get("utm_source"));
  const utmMedium = clip(q.get("utm_medium"));
  const utmCampaign = clip(q.get("utm_campaign"));
  const base = { referrerHost: host ? host.slice(0, 120) : null, utmSource, utmMedium, utmCampaign };
  // Ad click ids mean a paid click even without UTM tags.
  if (q.get("gclid") || q.get("gbraid") || q.get("wbraid")) return { ...base, source: "paid", sourceName: "Google Ads" };
  if (q.get("fbclid") && /paid|cpc/i.test(utmMedium ?? "")) return { ...base, source: "paid", sourceName: "Meta Ads" };
  if (q.get("ttclid")) return { ...base, source: "paid", sourceName: "TikTok Ads" };
  if (utmSource || utmMedium) {
    const c = utmChannel(utmSource ?? "", utmMedium ?? "");
    if (c) return { ...base, ...c };
  }
  if (!host) return { ...base, source: "direct", sourceName: null };
  const search = named(SEARCH, host);
  if (search) return { ...base, source: "search", sourceName: search };
  const social = named(SOCIAL, host);
  if (social) return { ...base, source: "social", sourceName: social };
  if (DISCORD.test(host)) return { ...base, source: "discord", sourceName: "Discord" };
  if (MAIL.test(host)) return { ...base, source: "email", sourceName: host };
  return { ...base, source: "referral", sourceName: host.slice(0, 120) };
}

/** Pathname only, lowercased query dropped, length capped. */
export function cleanPath(p: unknown): { path: string; search: string } | null {
  if (typeof p !== "string" || !p.startsWith("/") || p.startsWith("//") || p.length > 2000) return null;
  try {
    const u = new URL(p, "https://cardbit.com");
    const path = u.pathname.replace(/\/{2,}/g, "/").slice(0, 200) || "/";
    return { path, search: u.search.slice(0, 1000) };
  } catch {
    return null;
  }
}

// ---------- Recording ----------

const newId = () => randomBytes(18).toString("base64url");
const secure = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");
const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure()}`;

// Per-IP limiter: 120 events a minute is far beyond a person browsing.
const hits = new Map<string, { at: number; n: number }>();
function limited(ip: string | null) {
  if (!ip) return false;
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.at > 60_000) {
    hits.set(ip, { at: now, n: 1 });
    if (hits.size > 50_000) hits.clear();
    return false;
  }
  return ++h.n > 120;
}

export type PulseDeps = { db: PrismaClient; geo?: GeoLookup | null; now?: () => Date; env?: NodeJS.ProcessEnv };

/**
 * Records one beacon. Always answers 204 (a broken beacon must never break the page); the
 * Set-Cookie headers carry the visitor and visit ids.
 */
export async function recordPulse(request: Request, body: unknown, deps: PulseDeps): Promise<{ status: number; cookies: string[]; recorded: boolean }> {
  const { db } = deps;
  const env = deps.env ?? process.env;
  const now = deps.now?.() ?? new Date();
  const skip = { status: 204, cookies: [] as string[], recorded: false };
  const ua = (request.headers.get("user-agent") || "").slice(0, 400);
  if (isBot(ua)) return skip;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return skip;
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const kind = b.k === "view" ? "view" : b.k === "ping" ? "ping" : null;
  const loc = cleanPath(b.p);
  if (!kind || !loc) return skip;
  const ip = clientIp(request);
  if (limited(ip)) return skip;

  const knownVisitor = cookieValue(request, VISITOR_COOKIE);
  const visitorId = knownVisitor && ID_RE.test(knownVisitor) ? knownVisitor : newId();
  const visitCookie = cookieValue(request, VISIT_COOKIE);
  const cookies = [cookie(VISITOR_COOKIE, visitorId, 365 * 86400)];

  const customer = await currentCustomer(db, request).catch(() => null);
  const staff = !!customer && staffEmails(env).has(customer.email.toLowerCase());

  let visit =
    visitCookie && ID_RE.test(visitCookie)
      ? await db.siteVisit.findFirst({ where: { id: visitCookie, visitorId, lastSeenAt: { gt: new Date(now.getTime() - VISIT_IDLE_MS) } } })
      : null;

  if (!visit) {
    if (kind === "ping") return { ...skip, cookies };
    const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "cardbit.com").split(",")[0].trim();
    const attribution = classifySource(typeof b.r === "string" ? b.r.slice(0, 1000) : "", loc.search, host);
    const ua2 = parseUserAgent(ua);
    // A returning visitor is one whose cookie we already set, or whose account visited before.
    const seenBefore =
      (!!knownVisitor && ID_RE.test(knownVisitor)) ||
      (!!customer && (await db.siteVisit.count({ where: { customerId: customer.id }, take: 1 })) > 0);
    visit = await db.siteVisit.create({
      data: {
        visitorId,
        customerId: customer?.id ?? null,
        newVisitor: !seenBefore,
        staff,
        startedAt: now,
        lastSeenAt: now,
        landingPath: loc.path,
        exitPath: loc.path,
        pageviews: 1,
        ...attribution,
        ...ua2,
      },
    });
    await db.sitePageView.create({ data: { visitId: visit.id, path: loc.path, createdAt: now } });
    const geo = deps.geo === undefined ? defaultGeoLookup(env) : deps.geo;
    if (geo && ip && !isPrivateIp(ip)) {
      const id = visit.id;
      // Location is looked up once per visit, after the response, and never blocks the page.
      void geo(ip)
        .then((g) => (g?.country ? db.siteVisit.update({ where: { id }, data: { country: g.country.slice(0, 2).toUpperCase(), region: g.region ? String(g.region).slice(0, 8) : null } }) : null))
        .catch(() => undefined);
    }
    cookies.push(cookie(VISIT_COOKIE, visit.id, VISIT_IDLE_MS / 1000));
    return { status: 204, cookies, recorded: true };
  }

  const who = {
    ...(customer && !visit.customerId ? { customerId: customer.id } : {}),
    ...(staff && !visit.staff ? { staff: true } : {}),
  };
  cookies.push(cookie(VISIT_COOKIE, visit.id, VISIT_IDLE_MS / 1000));
  if (kind === "view") {
    if (visit.pageviews >= MAX_VIEWS_PER_VISIT) return { status: 204, cookies, recorded: false };
    await db.$transaction([
      db.sitePageView.create({ data: { visitId: visit.id, path: loc.path, createdAt: now } }),
      db.siteVisit.update({ where: { id: visit.id }, data: { lastSeenAt: now, exitPath: loc.path, pageviews: { increment: 1 }, ...who } }),
    ]);
    return { status: 204, cookies, recorded: true };
  }
  if (now.getTime() - visit.lastSeenAt.getTime() >= PING_WRITE_MS || Object.keys(who).length)
    await db.siteVisit.update({ where: { id: visit.id }, data: { lastSeenAt: now, exitPath: loc.path, ...who } });
  return { status: 204, cookies, recorded: true };
}
