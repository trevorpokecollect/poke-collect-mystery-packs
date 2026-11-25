import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { balanceOf } from "../core/ledger.server";
import { createCheckoutLink, handleCoinflowEvent, topupPackage, verifyWebhook } from "./coinflow.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const SECRET = "test-validation-key-1234567890";

const wipe = async () => {
  await db.siteWebhookEvent.deleteMany();
  await db.siteTopup.deleteMany();
  await db.siteLedger.deleteMany();
  await db.siteWallet.deleteMany();
  await db.siteCustomer.deleteMany();
};

describe("coinflow webhook verification", () => {
  const raw = JSON.stringify({ eventType: "Settled" });
  it("accepts the Authorization validation key", () => {
    expect(verifyWebhook(raw, new Headers({ authorization: SECRET }), SECRET)).toBe(true);
    expect(verifyWebhook(raw, new Headers({ authorization: "nope" }), SECRET)).toBe(false);
  });
  it("accepts a fresh Coinflow-Signature and rejects stale or forged ones", () => {
    const t = 1_800_000_000;
    const v1 = createHmac("sha256", SECRET).update(`${t}.${raw}`).digest("hex");
    expect(verifyWebhook(raw, new Headers({ "coinflow-signature": `t=${t},v1=${v1}` }), SECRET, t + 10)).toBe(true);
    expect(verifyWebhook(raw, new Headers({ "coinflow-signature": `t=${t},v1=${v1}` }), SECRET, t + 1000)).toBe(false);
    expect(verifyWebhook(raw + " ", new Headers({ "coinflow-signature": `t=${t},v1=${v1}` }), SECRET, t)).toBe(false);
    expect(verifyWebhook(raw, new Headers({ authorization: SECRET }), undefined)).toBe(false);
  });
});

describe("coinflow checkout link", () => {
  it("sends subtotal, webhookInfo, callback and IP, never logs the key", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ link: "https://sandbox.coinflow.cash/checkout/x" })));
    const topup = { id: "t1", customerId: "c1", baseBits: 10000, bonusBits: 500, cents: 10000 } as never;
    const link = await createCheckoutLink(
      { topup, email: "a@b.co", ip: "8.8.8.8", deviceId: "dev", callbackUrl: "https://site/x" },
      { COINFLOW_API_KEY: "k", COINFLOW_API_BASE: "https://api-sandbox.coinflow.cash/api/merchant/v2" } as never,
      fetcher as never,
    );
    expect(link).toMatch(/^https:/);
    const [u, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(u).toBe("https://api-sandbox.coinflow.cash/api/checkout/link");
    const body = JSON.parse(String(init.body));
    expect(body.subtotal).toEqual({ cents: 10000, currency: "USD" });
    expect(body.webhookInfo.topupId).toBe("t1");
    expect(body.standaloneLinkConfig).toEqual({ callbackUrl: "https://site/x", endUserDeviceIpAddress: "8.8.8.8" });
    expect((init.headers as Record<string, string>)["x-device-id"]).toBe("dev");
  });
});

describe.skipIf(!url)("coinflow top-up ledger", () => {
  let customerId = "";
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(async () => {
    await wipe();
    customerId = (await db.siteCustomer.create({ data: { email: "buyer@example.com" } })).id;
  });
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });
  const newTopup = (amount = 10000) =>
    db.siteTopup.create({ data: { customerId, ...topupPackage(amount)!, billingState: "TX", billingZip: "75001" } });
  const settled = (topupId: string, cents = 10000, id = "pay_1") => ({
    eventType: "Settled",
    data: { id, subtotal: { cents, currency: "USD" }, webhookInfo: { topupId, customerId } },
  });

  it("credits base + bonus once, even when Coinflow repeats or races the webhook", async () => {
    const t = await newTopup();
    const receipts: number[] = [];
    const deps = { db, onCredited: async (_t: unknown, bal: number) => void receipts.push(bal) };
    const results = await Promise.all([1, 2, 3].map(() => handleCoinflowEvent(deps, settled(t.id)).catch((e) => String(e))));
    expect(results.filter((r) => r === "credited")).toHaveLength(1);
    expect(await balanceOf(db, customerId)).toBe(10500);
    expect(await db.siteLedger.count({ where: { customerId } })).toBe(2);
    expect(receipts).toEqual([10500]);
    expect(await handleCoinflowEvent(deps, settled(t.id))).toBe("replay");
  });

  it("refuses to credit when the paid amount doesn't match", async () => {
    const t = await newTopup();
    expect(await handleCoinflowEvent({ db }, settled(t.id, 100))).toBe("rejected:amount_mismatch");
    expect(await balanceOf(db, customerId)).toBe(0);
  });

  it("refund takes back what's left and records the spent part as owed", async () => {
    const t = await newTopup(1000);
    await handleCoinflowEvent({ db }, settled(t.id, 1000, "pay_r"));
    await db.$executeRaw`UPDATE "SiteWallet" SET balance = 400 WHERE "customerId" = ${customerId}`;
    const ev = { eventType: "Refund", data: { refundId: "ref_1", paymentId: "pay_r", totals: { subtotal: { cents: 1000 } } } };
    expect(await handleCoinflowEvent({ db }, ev)).toBe("refunded:owed_600");
    expect(await handleCoinflowEvent({ db }, ev)).toBe("replay");
    expect(await balanceOf(db, customerId)).toBe(0);
    const after = await db.siteTopup.findUniqueOrThrow({ where: { id: t.id } });
    expect([after.status, after.clawedBits, after.owedBits]).toEqual(["REFUNDED", 400, 600]);
  });

  it("chargeback freezes the account and claws back; a won chargeback returns the Cardbits", async () => {
    const t = await newTopup(1000);
    await handleCoinflowEvent({ db }, settled(t.id, 1000, "pay_c"));
    expect(await handleCoinflowEvent({ db }, { eventType: "Card Payment Chargeback Opened", data: { id: "pay_c" } })).toBe("chargeback");
    expect(await balanceOf(db, customerId)).toBe(0);
    expect((await db.siteCustomer.findUniqueOrThrow({ where: { id: customerId } })).frozenAt).not.toBeNull();
    expect(await handleCoinflowEvent({ db }, { eventType: "Card Payment Chargeback Won", data: { id: "pay_c" } })).toBe("chargeback_won");
    expect(await balanceOf(db, customerId)).toBe(1000);
  });
});
