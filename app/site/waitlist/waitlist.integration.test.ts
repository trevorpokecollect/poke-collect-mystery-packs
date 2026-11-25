import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { balanceOf } from "../core/ledger.server";
import { handleCoinflowEvent, topupPackage } from "../payments/coinflow.server";
import { confirmSms, joinEmail, requestSms } from "../promos/promos.server";
import { FOUNDING_TAG, foundingView, joinWaitlist, WaitlistError } from "./waitlist.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const wipe = async () => {
  await db.siteWaitlist.deleteMany();
  await db.siteMarketing.deleteMany();
  await db.siteLedger.deleteMany();
  await db.siteWallet.deleteMany();
  await db.cardbitGiveawayEvent.deleteMany({ where: { shop: "cardbit-site" } });
  await db.siteTopup.deleteMany();
  await db.siteCustomer.deleteMany({ where: { email: { endsWith: "@wl.test" } } });
  await db.siteCustomer.deleteMany({ where: { email: { contains: "founder" } } });
};
const consent = { emailConsent: true };

describe.skipIf(!url)("waitlist signups", () => {
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(wipe);
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it("needs email consent and a real inbox", async () => {
    await expect(joinWaitlist(db, { email: "a@wl.test" })).rejects.toBeInstanceOf(WaitlistError);
    await expect(joinWaitlist(db, { email: "a@mailinator.com", ...consent })).rejects.toThrow(/Permanent/);
    await expect(joinWaitlist(db, { email: "a@wl.test", phone: "2565550100", ...consent })).rejects.toThrow(/Text Alerts Box/);
    expect((await joinWaitlist(db, { email: "a@wl.test", ...consent })).status).toBe("joined");
  });

  it("one spot per Gmail address, however it's written", async () => {
    expect((await joinWaitlist(db, { email: "ash.ketchum@gmail.com", ...consent })).status).toBe("joined");
    expect((await joinWaitlist(db, { email: "AshKetchum+2@gmail.com", ...consent })).status).toBe("already");
    expect(await db.siteWaitlist.count()).toBe(1);
  });

  it("adds a phone later; a phone already on the list saves the email only", async () => {
    await joinWaitlist(db, { email: "a@wl.test", ...consent });
    expect(await joinWaitlist(db, { email: "a@wl.test", phone: "(256) 555-0100", smsConsent: true, ...consent })).toMatchObject({ status: "updated", phoneSaved: true });
    const r = await joinWaitlist(db, { email: "b@wl.test", phone: "2565550100", smsConsent: true, ...consent });
    expect(r).toMatchObject({ status: "joined", phoneSaved: false, phoneTaken: true });
  });

  it("drops honeypot bots silently and caps signups per network", async () => {
    expect((await joinWaitlist(db, { email: "bot@wl.test", company: "Acme", ...consent })).status).toBe("joined");
    expect(await db.siteWaitlist.count()).toBe(0);
    for (let i = 0; i < 5; i++) await joinWaitlist(db, { email: `p${i}@wl.test`, ...consent }, { ip: "9.9.9.9" });
    await expect(joinWaitlist(db, { email: "p6@wl.test", ...consent }, { ip: "9.9.9.9" })).rejects.toMatchObject({ status: 429 });
  });

  it("handles a double tap without a second row", async () => {
    const both = await Promise.all([joinWaitlist(db, { email: "tap@wl.test", ...consent }), joinWaitlist(db, { email: "tap@wl.test", ...consent })]);
    expect(both.map((r) => r.status).sort()).toEqual(["already", "joined"]);
    expect(await db.siteWaitlist.count()).toBe(1);
  });
});

describe.skipIf(!url)("Founding Collector bonus", () => {
  beforeAll(() => {
    process.env.CARDBIT_SITE_WELCOME = "on";
  });
  beforeEach(wipe);

  const topup = async (customerId: string, amount = 1000, pay = "pay_" + Math.random().toString(36).slice(2)) => {
    const t = await db.siteTopup.create({ data: { customerId, ...topupPackage(amount)!, billingState: "TX", billingZip: "75001" } });
    const r = await handleCoinflowEvent({ db }, { eventType: "Settled", data: { id: pay, subtotal: { cents: t.cents, currency: "USD" }, webhookInfo: { topupId: t.id, customerId } } });
    expect(r).toBe("credited");
    return { t, pay };
  };
  const bonusTotal = async (customerId: string) =>
    (await db.siteLedger.findMany({ where: { customerId, kind: "BONUS" } })).reduce((n, r) => n + r.delta, 0);

  it("pays nothing before a top-up, then 1,000 in total with Welcome Rewards counted", async () => {
    await joinWaitlist(db, { email: "Founder.One+wl@gmail.com", phone: "2565550111", smsConsent: true, ...consent });
    const c = await db.siteCustomer.create({ data: { email: "founderone@gmail.com" } });
    await joinEmail(db, c, true); // regular Welcome Rewards: 200
    await requestSms(db, c, "2565550111", true);
    expect((await confirmSms(db, c.id, "+12565550111")).credited).toBe(300); // no top-up yet: only the regular 300
    expect(await bonusTotal(c.id)).toBe(500);

    await topup(c.id, 1000);
    expect(await bonusTotal(c.id)).toBe(1000); // founding tops it up to 1,000
    expect(await balanceOf(db, c.id)).toBe(1000 + 1000);
    expect((await db.siteCustomer.findUniqueOrThrow({ where: { id: c.id } })).tags).toContain(FOUNDING_TAG);
    expect(await foundingView(db, c)).toMatchObject({ emailCredited: true, smsCredited: true });

    await topup(c.id, 1000); // a second top-up pays nothing more
    expect(await bonusTotal(c.id)).toBe(1000);
  });

  it("text part arrives when the number confirms after the first top-up", async () => {
    await joinWaitlist(db, { email: "founder2@wl.test", ...consent });
    const c = await db.siteCustomer.create({ data: { email: "founder2@wl.test" } });
    await topup(c.id, 1000);
    expect(await bonusTotal(c.id)).toBe(400);
    await requestSms(db, c, "2565550122", true);
    expect((await confirmSms(db, c.id, "+12565550122")).credited).toBe(600); // 300 regular + 300 founding
    expect(await bonusTotal(c.id)).toBe(1000);
  });

  it("only the first account for a waitlist email can claim", async () => {
    await joinWaitlist(db, { email: "founder.three@gmail.com", ...consent });
    const a = await db.siteCustomer.create({ data: { email: "founder.three@gmail.com" } });
    const b = await db.siteCustomer.create({ data: { email: "founderthree@gmail.com" } });
    await topup(a.id, 1000);
    await topup(b.id, 1000);
    expect(await bonusTotal(a.id)).toBe(400);
    expect(await bonusTotal(b.id)).toBe(0);
    expect(await foundingView(db, b)).toBeNull();
  });

  it("people who never joined the waitlist get nothing extra", async () => {
    const c = await db.siteCustomer.create({ data: { email: "stranger@wl.test" } });
    await topup(c.id, 1000);
    expect(await bonusTotal(c.id)).toBe(0);
  });

  it("a refunded first top-up takes the founding bonus back", async () => {
    await joinWaitlist(db, { email: "founder4@wl.test", ...consent });
    const c = await db.siteCustomer.create({ data: { email: "founder4@wl.test" } });
    const { pay } = await topup(c.id, 1000);
    expect(await balanceOf(db, c.id)).toBe(1400);
    const ev = { eventType: "Refund", data: { refundId: "ref_f4", paymentId: pay, totals: { subtotal: { cents: 1000 } } } };
    expect(await handleCoinflowEvent({ db }, ev)).toBe("refunded");
    expect(await balanceOf(db, c.id)).toBe(0);
    expect(await handleCoinflowEvent({ db }, ev)).toBe("replay");
    expect(await balanceOf(db, c.id)).toBe(0);
  });
});
