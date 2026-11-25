import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { balanceOf } from "../core/ledger.server";
import { activeRound, enterOrBonus } from "../../giveaway/entries.server";
import { customerView } from "../../giveaway/service.server";
import {
  SITE_GIVEAWAY_SHOP as shop, confirmSms, joinEmail, leave, PromoError, requestSms, setSiteGiveaway,
  settleDueSiteRounds, siteFundEntries, subscribedToEmail, usPhone, voidSiteFundEntries, welcomeView,
} from "./promos.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const wipe = async () => {
  await db.siteMarketing.deleteMany();
  await db.siteLedger.deleteMany();
  await db.siteWallet.deleteMany();
  for (const t of [db.cardbitGiveawayEvent, db.cardbitGiveawayRound, db.cardbitGiveawayPerson, db.cardbitGiveawayAudit, db.cardbitGiveawayConfig] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }[])
    await t.deleteMany({ where: { shop } });
  await db.siteCustomer.deleteMany({ where: { email: { endsWith: "@promo.test" } } });
};

describe("usPhone", () => {
  it("accepts 10-digit US mobiles only", () => {
    expect(usPhone("(256) 555-0123")).toBe("+12565550123");
    expect(usPhone("1-256-555-0123")).toBe("+12565550123");
    expect(usPhone("123")).toBeNull();
    expect(usPhone("056-555-0123")).toBeNull();
  });
});

describe.skipIf(!url)("site promos", () => {
  let a: Awaited<ReturnType<typeof db.siteCustomer.create>>, b: typeof a;
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
    process.env.CARDBIT_SITE_WELCOME = "on";
  });
  beforeEach(async () => {
    await wipe();
    a = await db.siteCustomer.create({ data: { email: "a@promo.test", name: "Ann A" } });
    b = await db.siteCustomer.create({ data: { email: "b@promo.test", name: "Bo B" } });
  });
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it("credits 200 for email once, even after leaving and rejoining", async () => {
    await expect(joinEmail(db, a, false)).rejects.toBeInstanceOf(PromoError);
    expect((await joinEmail(db, a, true)).credited).toBe(200);
    await leave(db, a, "email");
    expect(await subscribedToEmail(db, a.id)).toBe(false);
    expect((await joinEmail(db, a, true)).credited).toBe(0);
    expect(await subscribedToEmail(db, a.id)).toBe(true);
    expect(await balanceOf(db, a.id)).toBe(200);
    const view = await welcomeView(db, a);
    expect(view).toMatchObject({ email: { status: "subscribed" }, sms: { status: null } });
  });

  it("holds the 300 for texts until the number confirms, one account per number", async () => {
    await requestSms(db, a, "256-555-0123", true);
    expect(await balanceOf(db, a.id)).toBe(0);
    expect((await welcomeView(db, a)).sms).toMatchObject({ status: "pending", last4: "0123", awardedAt: null });
    await expect(requestSms(db, b, "2565550123", true)).rejects.toThrow(/Another Cardbit Account/);
    expect((await confirmSms(db, a.id, "+12565550199")).credited).toBe(0); // wrong number
    expect((await confirmSms(db, a.id, "+12565550123")).credited).toBe(300);
    expect((await confirmSms(db, a.id, "+12565550123")).credited).toBe(0);
    expect(await balanceOf(db, a.id)).toBe(300);
    expect((await welcomeView(db, a)).sms).toMatchObject({ status: "subscribed" });
    await expect(requestSms(db, a, "2565550177", true)).rejects.toThrow(/Confirmed Number/);
  });

  it("runs its own drawing: requires email + Whatnot, pays the winner's site wallet", async () => {
    await expect(enterOrBonus(db, a.id, { intent: "whatnot", adult: true, region: "TX" }, shop)).rejects.toThrow(/paused/);
    await setSiteGiveaway(db, "test", { enabled: true, rulesUrl: "https://cardbit.com/official-rules", freeInstructions: "Mail a postcard." });
    for (const c of [a, b]) {
      await enterOrBonus(db, c.id, { intent: "whatnot", adult: true, region: "TX" }, shop);
      await enterOrBonus(db, c.id, { intent: "enter" }, shop);
    }
    await joinEmail(db, a, true); // b never subscribes, so only a is eligible
    const view = await customerView(db, a.id, true, shop);
    expect(view).toMatchObject({ enabled: true, entered: true, whatnotDone: true });
    expect(await db.cardbitGiveawayEvent.count({ where: { shop: "hhuuev-81.myshopify.com", customerId: a.id } })).toBe(0);
    const round = await activeRound(db as never, new Date(), shop);
    await db.cardbitGiveawayRound.update({ where: { shop_day: { shop, day: round.day } }, data: { closesAt: new Date(Date.now() - 1000) } });
    expect(await settleDueSiteRounds(db)).toBe(1);
    const closed = await db.cardbitGiveawayRound.findUniqueOrThrow({ where: { shop_day: { shop, day: round.day } } });
    expect(closed.winnerId).toBe(a.id);
    expect(closed.participantCount).toBe(1);
    expect(await balanceOf(db, a.id)).toBe(200 + 10000);
    expect(await settleDueSiteRounds(db)).toBe(0);
  });

  it("adds 1 entry per 100 paid Cardbits only while entries are open, and voids them on refund", async () => {
    await db.$transaction((tx) => siteFundEntries(tx, a.id, "t-closed", 1000));
    expect(await db.cardbitGiveawayEvent.count({ where: { shop } })).toBe(0);
    await setSiteGiveaway(db, "test", { enabled: true, rulesUrl: "https://cardbit.com/official-rules", freeInstructions: "Mail a postcard." });
    await db.$transaction((tx) => siteFundEntries(tx, a.id, "t1", 1050));
    await db.$transaction((tx) => siteFundEntries(tx, a.id, "t1", 1050));
    const e = await db.cardbitGiveawayEvent.findUniqueOrThrow({ where: { shop_key: { shop, key: "fund:t1" } } });
    expect(e).toMatchObject({ kind: "purchase", entries: 10, voided: false });
    await db.$transaction((tx) => voidSiteFundEntries(tx, "t1"));
    expect((await db.cardbitGiveawayEvent.findUniqueOrThrow({ where: { id: e.id } })).voided).toBe(true);
  });
});
