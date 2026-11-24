import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CARDBIT_SHOP as shop } from "./cardbit.server";
import {
  flagCustomer,
  guardRequest,
  recordSignal,
  riskProfile,
  setRiskStatus,
  shipHold,
  topupCheck,
} from "./cardbit-guard.server";

const url = process.env.TEST_DATABASE_URL;
const a = "gid://shopify/Customer/501", b = "gid://shopify/Customer/502", c = "gid://shopify/Customer/503", d = "gid://shopify/Customer/504";
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const env = (extra: Record<string, string> = {}) =>
  ({ CARDBIT_STOREFRONT_SHOP: shop, CARDBIT_GUARD: "on", ...extra }) as NodeJS.ProcessEnv;
const req = (q = "") => new Request("https://cardbit.com/apps/packs/api/rewards" + q, { method: "POST" });
const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe.skipIf(!url)("Cardbit guard integration", () => {
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
    vi.stubEnv("CARDBIT_STOREFRONT_SHOP", shop);
  });
  beforeEach(async () => {
    await db.cardbitGuardEvent.deleteMany({ where: { shop } });
    await db.cardbitRiskSignal.deleteMany({ where: { shop } });
    await db.cardbitRiskProfile.deleteMany({ where: { shop } });
    await db.cardbitReceipt.deleteMany({ where: { shop, customerId: { in: [a, b, c, d] } } });
    await db.rateLimitHit.deleteMany({ where: { key: { startsWith: "cb:" } } });
  });
  afterAll(async () => {
    await db.$disconnect();
    vi.unstubAllEnvs();
  });

  it("rate limits per customer, refusing only when on", async () => {
    for (let i = 0; i < 5; i++) expect(await guardRequest(req(), { db, shop, customerId: a, action: "checkin", env: env() })).toBeNull();
    const refused = await guardRequest(req(), { db, shop, customerId: a, action: "checkin", env: env() });
    expect(refused?.status).toBe(429);
    // Another customer is unaffected.
    expect(await guardRequest(req(), { db, shop, customerId: b, action: "checkin", env: env() })).toBeNull();
    // Log mode records but lets it through.
    expect(await guardRequest(req(), { db, shop, customerId: a, action: "checkin", env: env({ CARDBIT_GUARD: "log" }) })).toBeNull();
    const events = await db.cardbitGuardEvent.findMany({ where: { shop, customerId: a } });
    expect(events.map((e) => [e.rule, e.enforced])).toEqual(
      expect.arrayContaining([["rate-limit", true], ["rate-limit", false]]),
    );
  });

  it("does nothing for other stores or when off", async () => {
    expect(await guardRequest(req(), { db, shop: "other.myshopify.com", customerId: a, action: "ship", env: env() })).toBeNull();
    await flagCustomer(db, shop, a, "test", undefined, "blocked");
    expect(await guardRequest(req(), { db, shop, customerId: a, action: "ship", env: env({ CARDBIT_GUARD: "off" }) })).toBeNull();
  });

  it("puts every account sharing one device into review once more than three share it", async () => {
    for (const id of [a, b, c]) await recordSignal(db, shop, id, "device", "device-123456789012");
    expect((await riskProfile(db, shop, a)).status).toBe("ok");
    await recordSignal(db, shop, d, "device", "device-123456789012");
    for (const id of [a, b, c, d]) expect((await riskProfile(db, shop, id)).status).toBe("review");
    // Recording again doesn't pile up duplicate reasons.
    await recordSignal(db, shop, d, "device", "device-123456789012");
    const reasons = (await riskProfile(db, shop, d)).reasons as unknown[];
    expect(reasons).toHaveLength(1);
  });

  it("review pauses spins and shipping but not packs; staff can release or trust", async () => {
    await flagCustomer(db, shop, a, "order-high-risk", "gid://shopify/Order/1");
    expect((await guardRequest(req(), { db, shop, customerId: a, action: "spin", env: env() }))?.status).toBe(403);
    expect(await guardRequest(req(), { db, shop, customerId: a, action: "pack", env: env() })).toBeNull();
    await setRiskStatus(db, shop, a, "trusted", "trevor");
    expect(await guardRequest(req(), { db, shop, customerId: a, action: "spin", env: env() })).toBeNull();
    // A later automatic flag doesn't undo staff trust; blocking still does.
    expect((await flagCustomer(db, shop, a, "shared-device", "x")).status).toBe("trusted");
    expect((await flagCustomer(db, shop, a, "manual", "x", "blocked")).status).toBe("blocked");
  });

  it("requires Turnstile on reward actions once the secret is set", async () => {
    const e = env({ CARDBIT_TURNSTILE_SECRET_KEY: "secret" });
    const ok = (async () => new Response(JSON.stringify({ success: true, hostname: "cardbit.com" }))) as unknown as typeof fetch;
    expect((await guardRequest(req(), { db, shop, customerId: a, action: "spin", env: e }))?.status).toBe(403);
    expect(await guardRequest(req("?cbt=token"), { db, shop, customerId: a, action: "spin", env: e, fetchImpl: ok })).toBeNull();
    expect(await guardRequest(req(), { db, shop, customerId: a, action: "pack", env: e })).toBeNull();
  });

  it("holds shipping for new accounts and fresh top-ups", async () => {
    await db.cardbitRiskProfile.create({ data: { shop, customerId: a, accountCreatedAt: daysAgo(1) } });
    expect((await shipHold(db, shop, a, null, env()))?.status).toBe(403);
    expect(await shipHold(db, shop, a, null, env({ CARDBIT_GUARD: "log" }))).toBeNull();
    await db.cardbitRiskProfile.update({ where: { shop_customerId: { shop, customerId: a } }, data: { accountCreatedAt: daysAgo(30) } });
    expect(await shipHold(db, shop, a, null, env())).toBeNull();
    await db.cardbitReceipt.create({
      data: { shop, customerId: a, eventKey: "fund:test-1", fingerprint: "f", kind: "topup", delta: 1000, qualifyingPaidCents: 1000 },
    });
    const held = await shipHold(db, shop, a, null, env());
    expect(held?.status).toBe(403);
    expect(((await held!.json()) as { shipOpensAt: string }).shipOpensAt).toBeTruthy();
  });

  it("caps top-ups for new accounts and asks for 3D Secure", async () => {
    await db.cardbitRiskProfile.create({ data: { shop, customerId: a, accountCreatedAt: daysAgo(1) } });
    expect(await topupCheck(db, shop, a, 10_000, null, env())).toMatchObject({ allowed: true, threeDSecure: "any" });
    await db.cardbitReceipt.create({
      data: { shop, customerId: a, eventKey: "fund:test-2", fingerprint: "f", kind: "topup", delta: 5000, qualifyingPaidCents: 5000 },
    });
    expect(await topupCheck(db, shop, a, 10_000, null, env())).toMatchObject({ allowed: false, maxCents: 5000 });
    expect(await topupCheck(db, shop, a, 10_000, null, env({ CARDBIT_GUARD: "log" }))).toMatchObject({ allowed: true });
  });
});
