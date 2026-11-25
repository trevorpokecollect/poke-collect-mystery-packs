import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { klaviyoConfig, METRICS, noteShortfall, resetKlaviyoAccountCheck, runKlaviyoSync, type Fetch } from "./klaviyo.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const env = { KLAVIYO_PRIVATE_KEY: "pk_test", KLAVIYO_EMAIL_LIST_ID: "LIST1", SITE_ORIGIN: "https://cardbit.com" } as NodeJS.ProcessEnv;

type Call = { method: string; path: string; body: any };
function fakeKlaviyo(org = "Cardbit", fail?: (c: Call) => number | null) {
  const calls: Call[] = [];
  const f = (async (input: string, init: RequestInit) => {
    const c = { method: init.method!, path: String(input).replace("https://a.klaviyo.com/api", ""), body: init.body ? JSON.parse(String(init.body)) : null };
    calls.push(c);
    const status = fail?.(c) ?? null;
    if (status) return new Response("nope", { status });
    if (c.path === "/accounts") return new Response(JSON.stringify({ data: [{ attributes: { contact_information: { organization_name: org } } }] }), { status: 200 });
    return new Response("", { status: 202 });
  }) as unknown as Fetch;
  return { calls, fetch: f };
}

const wipe = async () => {
  await db.siteKlaviyoEvent.deleteMany();
  await db.siteMarketing.deleteMany();
  await db.siteTopup.deleteMany({ where: { billingZip: "00000" } });
  await db.siteWant.deleteMany();
  await db.siteCopyEvent.deleteMany({ where: { actor: "klaviyo-test" } });
  await db.siteCopy.deleteMany({ where: { receiptKey: { startsWith: "kl-test" } } });
  await db.siteOpening.deleteMany({ where: { packId: "kl-pack" } });
  await db.siteRestock.deleteMany({ where: { packId: "kl-pack" } });
  await db.sitePack.deleteMany({ where: { id: "kl-pack" } });
  await db.siteCustomer.deleteMany({ where: { email: { endsWith: "@klaviyo.test" } } });
};

describe("klaviyoConfig", () => {
  it("is off without a key or with KLAVIYO_SYNC=off", () => {
    expect(klaviyoConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(klaviyoConfig({ ...env, KLAVIYO_SYNC: "off" })).toBeNull();
    expect(klaviyoConfig(env)?.emailListId).toBe("LIST1");
  });
});

describe.skipIf(!url)("site Klaviyo sync", () => {
  let fan: Awaited<ReturnType<typeof db.siteCustomer.create>>, quiet: typeof fan;
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(async () => {
    resetKlaviyoAccountCheck();
    await wipe();
    fan = await db.siteCustomer.create({ data: { email: "fan@klaviyo.test", name: "Ash Ketch" } });
    quiet = await db.siteCustomer.create({ data: { email: "quiet@klaviyo.test" } });
    await db.siteMarketing.create({ data: { customerId: fan.id, emailOptInAt: new Date(Date.now() - 60_000) } });
    await db.sitePack.create({ data: { id: "kl-pack", title: "Gold Pack", priceBits: 3899, active: true } });
  });
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it("does nothing without a key", async () => {
    const k = fakeKlaviyo();
    expect(await runKlaviyoSync({ db, env: {} as NodeJS.ProcessEnv, fetch: k.fetch })).toEqual({ enabled: false });
    expect(k.calls).toHaveLength(0);
  });

  it("refuses a key from another Klaviyo account (e.g. Poke-Collect)", async () => {
    const k = fakeKlaviyo("Poke-Collect");
    await db.siteTopup.create({ data: { customerId: fan.id, baseBits: 1000, bonusBits: 0, cents: 1000, billingState: "TN", billingZip: "00000" } });
    const r = await runKlaviyoSync({ db, env, fetch: k.fetch });
    expect(r).toMatchObject({ enabled: false, reason: "wrong_account" });
    expect(k.calls.map((c) => c.path)).toEqual(["/accounts"]);
    expect(await db.siteKlaviyoEvent.count()).toBe(0);
  });

  it("subscribes opted-in customers to the Email List and marks them synced", async () => {
    await db.siteMarketing.create({ data: { customerId: quiet.id, emailOptInAt: new Date(Date.now() - 120_000), emailOptOutAt: new Date(Date.now() - 60_000) } });
    const k = fakeKlaviyo();
    await runKlaviyoSync({ db, env, fetch: k.fetch });
    const sub = k.calls.find((c) => c.path === "/profile-subscription-bulk-create-jobs")!;
    expect(sub.body.data.relationships.list.data.id).toBe("LIST1");
    expect(sub.body.data.attributes.profiles.data.map((p: any) => p.attributes.email)).toEqual(["fan@klaviyo.test"]);
    const unsub = k.calls.find((c) => c.path === "/profile-subscription-bulk-delete-jobs")!;
    expect(unsub.body.data.attributes.profiles.data[0].attributes.email).toBe("quiet@klaviyo.test");
    expect(unsub.body.data.relationships).toBeUndefined();
    expect(await db.siteMarketing.count({ where: { syncedAt: null } })).toBe(0);
    // Second pass: nothing changed, nothing re-sent.
    const k2 = fakeKlaviyo();
    await runKlaviyoSync({ db, env, fetch: k2.fetch });
    expect(k2.calls.filter((c) => c.path.startsWith("/profile-subscription"))).toHaveLength(0);
  });

  it("sends flow events only for customers with consent, once each", async () => {
    const t = await db.siteTopup.create({ data: { customerId: fan.id, baseBits: 1000, bonusBits: 0, cents: 1000, billingState: "TN", billingZip: "00000" } });
    await db.siteTopup.create({ data: { customerId: quiet.id, baseBits: 1000, bonusBits: 0, cents: 1000, billingState: "TN", billingZip: "00000" } });
    const k = fakeKlaviyo();
    await runKlaviyoSync({ db, env, fetch: k.fetch });
    const events = k.calls.filter((c) => c.path === "/events");
    expect(events).toHaveLength(1);
    const a = events[0].body.data.attributes;
    expect(a.metric.data.attributes.name).toBe(METRICS.topupStarted);
    expect(a.profile.data.attributes).toMatchObject({ email: "fan@klaviyo.test", external_id: fan.id, first_name: "Ash" });
    expect(a.properties.checkout_url).toBe("https://cardbit.com/cardbits");
    expect(a.unique_id).toBe(`topup-started:${t.id}`);

    await db.siteTopup.update({ where: { id: t.id }, data: { status: "CREDITED" } });
    const k2 = fakeKlaviyo();
    await runKlaviyoSync({ db, env, fetch: k2.fetch });
    expect(k2.calls.filter((c) => c.path === "/events").map((c) => c.body.data.attributes.metric.data.attributes.name)).toEqual([METRICS.toppedUp]);
  });

  it("queues back-in-stock, restock and browse events with new-site links", async () => {
    const copy = await db.siteCopy.create({
      data: { receiptKey: "kl-test:1", printingKey: "pk-charizard", title: "Charizard ex", game: "Pokemon", setName: "Obsidian Flames", number: "125", name: "Charizard ex", finish: "Holo", language: "English", condition: "NM", lookKey: "kl1", faceKey: "kl1", status: "FOR_SALE" },
    });
    await db.siteCopyEvent.create({ data: { copyId: copy.id, fromStatus: "DRAFT", toStatus: "FOR_SALE", actor: "klaviyo-test", reason: "listed" } });
    await db.siteWant.create({ data: { customerId: fan.id, cardKey: "pk-charizard" } });
    await db.siteOpening.create({ data: { customerId: fan.id, packId: "kl-pack", priceBits: 3899, createdAt: new Date(Date.now() - 5 * 86400_000) } });
    await db.siteRestock.create({ data: { packId: "kl-pack", status: "LIVE", version: 2, poolHash: "h2", liveAt: new Date() } });
    await db.siteRestock.create({ data: { packId: "kl-pack", status: "LIVE", version: 3, poolHash: "h3", liveAt: new Date(), auto: true } });
    const visit = await db.siteVisit.create({ data: { visitorId: "v", customerId: fan.id, landingPath: "/", exitPath: "/", source: "direct", device: "desktop" } });
    await db.sitePageView.create({ data: { visitId: visit.id, path: "/packs/kl-pack" } });

    const k = fakeKlaviyo();
    await runKlaviyoSync({ db, env, fetch: k.fetch });
    const byMetric = new Map(k.calls.filter((c) => c.path === "/events").map((c) => [c.body.data.attributes.metric.data.attributes.name, c.body.data.attributes.properties]));
    expect(byMetric.get(METRICS.backInStock)).toMatchObject({ item_name: "Charizard ex", condition_display: "NM" });
    expect(byMetric.get(METRICS.backInStock).item_url).toMatch(/^https:\/\/cardbit\.com\/shop\/s_[0-9a-f]{20}$/);
    expect(byMetric.get(METRICS.restocked)).toMatchObject({ edition_name: "Gold Pack", edition_key: "gold", item_url: "https://cardbit.com/packs/kl-pack", restock_version: 2 });
    expect(byMetric.get(METRICS.viewed)).toMatchObject({ item_type: "pack", item_url: "https://cardbit.com/packs/kl-pack" });
    // The automatic hourly restock does not email anyone.
    expect(await db.siteKlaviyoEvent.count({ where: { metric: METRICS.restocked } })).toBe(1);
    await db.siteVisit.delete({ where: { id: visit.id } });
    await db.sitePageView.deleteMany({ where: { visitId: visit.id } });
  });

  it("records a Not Enough Cardbits event and retries Klaviyo outages", async () => {
    expect(await noteShortfall(db, fan, { action: "open", id: "kl-pack" }, env)).toBe(1);
    expect(await noteShortfall(db, fan, { action: "open", id: "kl-pack" }, env)).toBe(0); // once a day per item
    expect(await noteShortfall(db, quiet, { action: "open", id: "kl-pack" }, env)).toBe(0); // no consent
    const k = fakeKlaviyo("Cardbit", (c) => (c.path === "/events" ? 429 : null));
    const r = await runKlaviyoSync({ db, env, fetch: k.fetch });
    expect(r).toMatchObject({ enabled: true, failed: 1 });
    const row = await db.siteKlaviyoEvent.findFirstOrThrow({ where: { metric: METRICS.shortfall } });
    expect(row.status).toBe("FAILED");
    expect(row.properties).toMatchObject({ item_name: "Gold Pack", needed_cardbits: 3899, topup_url: "https://cardbit.com/cardbits" });
    await db.siteKlaviyoEvent.update({ where: { id: row.id }, data: { nextAt: new Date(0) } });
    const k2 = fakeKlaviyo();
    await runKlaviyoSync({ db, env, fetch: k2.fetch });
    expect((await db.siteKlaviyoEvent.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("SENT");
  });
});
