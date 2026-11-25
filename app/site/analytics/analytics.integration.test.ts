import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { classifySource, cleanPath, parseUserAgent, recordPulse } from "./track.server";
import { live, overview, parseRange, traffic, zonedMidnight } from "./report.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

describe("classification", () => {
  it("names channels from UTM tags, referrers and ad click ids", () => {
    expect(classifySource("https://www.google.com/", "", "cardbit.com")).toMatchObject({ source: "search", sourceName: "Google" });
    expect(classifySource("https://l.instagram.com/", "", "cardbit.com")).toMatchObject({ source: "social", sourceName: "Instagram" });
    expect(classifySource("https://discord.com/channels/1", "", "cardbit.com")).toMatchObject({ source: "discord" });
    expect(classifySource("", "?utm_source=klaviyo&utm_medium=email&utm_campaign=welcome", "cardbit.com")).toMatchObject({ source: "email", utmCampaign: "welcome" });
    expect(classifySource("", "?utm_source=ig&utm_medium=paid_social", "cardbit.com")).toMatchObject({ source: "paid" });
    expect(classifySource("", "?gclid=abc", "cardbit.com")).toMatchObject({ source: "paid", sourceName: "Google Ads" });
    expect(classifySource("https://cardbit.com/packs", "", "cardbit.com")).toMatchObject({ source: "direct", referrerHost: null });
    expect(classifySource("https://pokebeach.com/x", "", "cardbit.com")).toMatchObject({ source: "referral", sourceName: "pokebeach.com" });
    expect(classifySource("", "", "cardbit.com")).toMatchObject({ source: "direct" });
  });
  it("reads devices and keeps paths only", () => {
    expect(parseUserAgent(IPHONE)).toEqual({ device: "mobile", browser: "Safari", os: "iOS" });
    expect(parseUserAgent(MAC)).toEqual({ device: "desktop", browser: "Chrome", os: "macOS" });
    expect(cleanPath("/packs/gold?utm_source=x")).toEqual({ path: "/packs/gold", search: "?utm_source=x" });
    expect(cleanPath("https://evil.example/")).toBeNull();
    expect(cleanPath("//evil.example/")).toBeNull();
  });
  it("turns local days into Central time instants", () => {
    expect(zonedMidnight("2026-11-25").toISOString()).toBe("2026-11-25T06:00:00.000Z");
    expect(zonedMidnight("2026-07-04").toISOString()).toBe("2026-07-04T05:00:00.000Z");
    const r = parseRange("2026-11-20", "2026-11-25", new Date("2026-11-25T18:00:00Z"));
    expect(r.days).toBe(6);
    expect(r.end.toISOString()).toBe("2026-11-26T06:00:00.000Z");
  });
});

describe.skipIf(!url)("analytics", () => {
  const env = { ...process.env, CARDBIT_SITE: "on", SITE_STAFF_EMAILS: "staff-an@example.com" };
  let staffId = "";
  let buyerId = "";

  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(async () => {
    await db.sitePageView.deleteMany();
    await db.siteVisit.deleteMany();
    // Reports read whole tables, so start from empty ones (test files run one at a time).
    await db.siteOpeningFair.deleteMany();
    await db.siteTopup.deleteMany();
    await db.siteOpening.deleteMany();
    await db.siteLedger.deleteMany();
    await db.siteSession.deleteMany({ where: { id: { startsWith: "an-" } } });
    await db.siteCustomer.deleteMany({ where: { email: { endsWith: "-an@example.com" } } });
    staffId = (await db.siteCustomer.create({ data: { email: "staff-an@example.com" } })).id;
    buyerId = (await db.siteCustomer.create({ data: { email: "buyer-an@example.com" } })).id;
  });
  afterAll(() => db.$disconnect());

  const req = (ua: string, cookies = "", ip = "203.0.113.9") =>
    new Request("https://cardbit.com/api/pulse", { method: "POST", headers: { "user-agent": ua, cookie: cookies, "x-forwarded-for": ip, "sec-fetch-site": "same-origin", host: "cardbit.com" } });
  const jar = (set: string[]) => set.map((c) => c.split(";")[0]).join("; ");

  it("records a visit, its pages and pings; skips bots and cross-site posts", async () => {
    const now = new Date();
    const a = await recordPulse(req(IPHONE), { k: "view", p: "/?utm_source=discord", r: "" }, { db, geo: async () => ({ country: "US", region: "TX" }), env, now: () => now });
    expect(a.recorded).toBe(true);
    const cookies = jar(a.cookies);
    await recordPulse(req(IPHONE, cookies), { k: "view", p: "/packs/gold", r: "" }, { db, geo: null, env, now: () => new Date(now.getTime() + 5000) });
    await recordPulse(req(IPHONE, cookies), { k: "ping", p: "/packs/gold" }, { db, geo: null, env, now: () => new Date(now.getTime() + 60000) });
    await new Promise((r) => setTimeout(r, 50));
    const visits = await db.siteVisit.findMany();
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({ source: "discord", device: "mobile", pageviews: 2, landingPath: "/", exitPath: "/packs/gold", newVisitor: true, country: "US", region: "TX" });
    expect(visits[0].lastSeenAt.getTime()).toBe(now.getTime() + 60000);
    expect(await db.sitePageView.count()).toBe(2);

    expect((await recordPulse(req("Googlebot/2.1"), { k: "view", p: "/" }, { db, env })).recorded).toBe(false);
    const cross = new Request("https://cardbit.com/api/pulse", { method: "POST", headers: { "user-agent": MAC, "sec-fetch-site": "cross-site" } });
    expect((await recordPulse(cross, { k: "view", p: "/" }, { db, env })).recorded).toBe(false);
    // A ping with no visit starts nothing.
    expect((await recordPulse(req(MAC), { k: "ping", p: "/" }, { db, env, geo: null })).recorded).toBe(false);
    expect(await db.siteVisit.count()).toBe(1);
  });

  it("starts a new visit after 30 idle minutes and marks the visitor as returning", async () => {
    const t0 = new Date();
    const a = await recordPulse(req(MAC), { k: "view", p: "/" }, { db, geo: null, env, now: () => t0 });
    await recordPulse(req(MAC, jar(a.cookies)), { k: "view", p: "/singles" }, { db, geo: null, env, now: () => new Date(t0.getTime() + 31 * 60_000) });
    const visits = await db.siteVisit.findMany({ orderBy: { startedAt: "asc" } });
    expect(visits).toHaveLength(2);
    expect(visits[1].newVisitor).toBe(false);
    expect(visits[1].visitorId).toBe(visits[0].visitorId);
  });

  it("reports sales, conversion and traffic without staff or demo activity", async () => {
    const now = new Date();
    // Buyer: a visit, a paid top-up and a pack during it, plus an abandoned checkout.
    const v = await db.siteVisit.create({ data: { visitorId: "visitor-buyer-0000001", customerId: buyerId, landingPath: "/", exitPath: "/packs", source: "social", sourceName: "Instagram", device: "mobile", pageviews: 3, startedAt: new Date(now.getTime() - 10 * 60_000), lastSeenAt: new Date(now.getTime() - 60_000), country: "US", region: "TX" } });
    await db.sitePageView.createMany({ data: ["/", "/packs", "/packs"].map((path) => ({ visitId: v.id, path, createdAt: new Date(now.getTime() - 2 * 60_000) })) });
    await db.siteVisit.create({ data: { visitorId: "visitor-anon-00000001", landingPath: "/", exitPath: "/", source: "direct", device: "desktop", pageviews: 1, startedAt: new Date(now.getTime() - 20 * 60_000), lastSeenAt: new Date(now.getTime() - 20 * 60_000) } });
    await db.siteTopup.create({ data: { customerId: buyerId, baseBits: 5000, bonusBits: 0, cents: 5000, status: "CREDITED", paymentId: "an:1", billingState: "TX", billingZip: "75001", createdAt: new Date(now.getTime() - 5 * 60_000) } });
    await db.siteTopup.create({ data: { customerId: buyerId, baseBits: 10000, bonusBits: 500, cents: 10000, status: "PENDING", paymentId: "an:2", billingState: "TX", billingZip: "75001", createdAt: new Date(now.getTime() - 2 * 3600_000) } });
    await db.siteOpening.create({ data: { customerId: buyerId, packId: "cobalt", priceBits: 1234, createdAt: new Date(now.getTime() - 4 * 60_000) } });
    await db.siteOpening.create({ data: { customerId: buyerId, packId: "cobalt", priceBits: 1234, demo: true, createdAt: new Date(now.getTime() - 4 * 60_000) } });
    await db.siteLedger.create({ data: { customerId: buyerId, delta: 800, balanceAfter: 800, kind: "BUYBACK", idempotencyKey: "an:bb", createdAt: new Date(now.getTime() - 3 * 60_000) } });
    // Staff: everything here must be left out.
    await db.siteVisit.create({ data: { visitorId: "visitor-staff-0000001", customerId: staffId, staff: true, landingPath: "/", exitPath: "/", source: "direct", device: "desktop", startedAt: new Date(now.getTime() - 60_000), lastSeenAt: now } });
    await db.siteVisit.create({ data: { visitorId: "visitor-staff-0000001", landingPath: "/", exitPath: "/", source: "direct", device: "desktop", startedAt: new Date(now.getTime() - 90 * 60_000), lastSeenAt: new Date(now.getTime() - 90 * 60_000) } });
    await db.siteTopup.create({ data: { customerId: staffId, baseBits: 50000, bonusBits: 5000, cents: 50000, status: "CREDITED", paymentId: "an:3", billingState: "TX", billingZip: "75001" } });

    const o = await overview(db, {}, { env, now });
    expect(o.current.grossCents).toBe(5000);
    expect(o.current.topups).toMatchObject({ n: 1, paidBits: 5000, bonusBits: 0, abandoned: 1 });
    expect(o.current.packs).toEqual({ n: 1, bits: 1234 });
    expect(o.current.buybacks).toEqual({ n: 1, bits: 800 });
    expect(o.current.sessions).toBe(2);
    expect(o.current.converted).toBe(1);
    expect(o.current.conversionRate).toBe(0.5);
    expect(o.current.customers.buyers).toBe(1);
    expect(o.series.reduce((s, x) => s + x.cents, 0)).toBe(5000);
    expect(o.topPacks[0]).toMatchObject({ id: "cobalt", n: 1 });

    const l = await live(db, { env, now });
    expect(l.visitors).toBe(1);
    expect(l.pages[0]).toEqual({ key: "/packs", n: 1 });
    expect(l.places[0].key).toBe("TX, US");
    expect(l.feed.map((f) => f.kind)).toEqual(expect.arrayContaining(["topup", "pack", "buyback"]));
    expect(l.feed.some((f) => f.email === "staff-an@example.com")).toBe(false);

    const t = await traffic(db, {}, { env, now });
    expect(t.current.sessions).toBe(2);
    expect(t.current.bounceRate).toBe(0.5);
    expect(t.sources.map((s) => s.key).sort()).toEqual(["direct", "social"]);
    expect(t.referrers[0]).toMatchObject({ key: "Instagram", converted: 1 });
    expect(t.pages[0]).toEqual({ key: "/packs", views: 2, visits: 1 });
  });
});
