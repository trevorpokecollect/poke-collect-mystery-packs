import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  LimitReached,
  PlayPaused,
  assertNotPaused,
  assertWithinLimits,
  cancelPending,
  playControl,
  playSummary,
  selfExclude,
  setLimit,
  startCoolOff,
} from "./limits.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const H = 3_600_000;
const t0 = new Date("2026-12-01T12:00:00Z");
const at = (h: number) => new Date(t0.getTime() + h * H);

const wipe = async () => {
  await db.sitePlayEvent.deleteMany();
  await db.sitePlayControl.deleteMany();
  await db.siteTopup.deleteMany();
  await db.siteLedger.deleteMany();
};

describe.skipIf(!url)("site responsible-play controls", () => {
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(wipe);
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it("applies a tighter limit at once and waits 24h to loosen or remove it", async () => {
    expect((await setLimit(db, "c1", "topup:day", 5000, t0)).applied).toBe(true);
    expect((await setLimit(db, "c1", "topup:day", 2000, at(1))).applied).toBe(true);
    const raise = await setLimit(db, "c1", "topup:day", 10000, at(2));
    expect(raise.applied).toBe(false);
    expect((await playControl(db, "c1", at(3))).limits["topup:day"]).toBe(2000);
    expect((await playControl(db, "c1", at(26))).limits["topup:day"]).toBe(10000);
    await setLimit(db, "c1", "topup:day", null, at(27));
    expect((await playControl(db, "c1", at(28))).limits["topup:day"]).toBe(10000);
    expect((await playControl(db, "c1", at(52))).limits["topup:day"]).toBeUndefined();
    expect(await db.sitePlayEvent.count({ where: { customerId: "c1" } })).toBeGreaterThanOrEqual(5);
  });

  it("keeps the current limit when a pending raise is canceled", async () => {
    await setLimit(db, "c2", "spend:week", 1000, t0);
    await setLimit(db, "c2", "spend:week", 9000, at(1));
    await cancelPending(db, "c2", "spend:week", at(2));
    expect((await playControl(db, "c2", at(30))).limits["spend:week"]).toBe(1000);
  });

  it("blocks top-ups over the limit, counting credited and recent pending checkouts", async () => {
    await setLimit(db, "c3", "topup:day", 6000, t0);
    const base = { customerId: "c3", baseBits: 5000, bonusBits: 0, cents: 5000, billingState: "TX", billingZip: "75001" };
    await db.siteTopup.create({ data: { ...base, status: "CREDITED", createdAt: at(-1) } });
    await expect(assertWithinLimits(db, "c3", "topup", 1000, t0)).resolves.toBeUndefined();
    await expect(assertWithinLimits(db, "c3", "topup", 5000, t0)).rejects.toBeInstanceOf(LimitReached);
    // A stale unpaid checkout (over 2h old) no longer counts; a fresh one does.
    await db.siteTopup.create({ data: { ...base, cents: 1000, status: "PENDING", createdAt: at(-3) } });
    await expect(assertWithinLimits(db, "c3", "topup", 1000, t0)).resolves.toBeUndefined();
    await db.siteTopup.create({ data: { ...base, cents: 1000, status: "PENDING", createdAt: at(-0.5) } });
    await expect(assertWithinLimits(db, "c3", "topup", 1000, t0)).rejects.toThrow(/daily Top-Up Limit of \$60/);
    // Outside the 24h window it's free again.
    await expect(assertWithinLimits(db, "c3", "topup", 1000, at(25))).resolves.toBeUndefined();
  });

  it("blocks spend over the limit from PACK and SINGLE ledger debits", async () => {
    await setLimit(db, "c4", "spend:month", 2000, t0);
    await db.siteLedger.create({ data: { customerId: "c4", delta: -1500, balanceAfter: 0, kind: "PACK", idempotencyKey: "p1", createdAt: at(-48) } });
    await db.siteLedger.create({ data: { customerId: "c4", delta: -400, balanceAfter: 0, kind: "SINGLE", idempotencyKey: "s1", createdAt: at(-1) } });
    await expect(assertWithinLimits(db, "c4", "spend", 100, t0)).resolves.toBeUndefined();
    await expect(assertWithinLimits(db, "c4", "spend", 101, t0)).rejects.toBeInstanceOf(LimitReached);
    const s = await playSummary(db, "c4", t0);
    expect(s.used["spend:month"]).toBe(1900);
  });

  it("cool-off and self-exclusion pause play, can't be shortened, then expire", async () => {
    await assertNotPaused(db, "c5", t0);
    const until = await startCoolOff(db, "c5", 72, t0);
    await expect(assertNotPaused(db, "c5", at(1))).rejects.toBeInstanceOf(PlayPaused);
    // A shorter cool-off doesn't cut the longer one.
    expect((await startCoolOff(db, "c5", 24, at(1))).getTime()).toBe(until.getTime());
    await expect(assertNotPaused(db, "c5", at(73))).resolves.toBeUndefined();
    const ex = await selfExclude(db, "c5", 6, at(80));
    expect((await selfExclude(db, "c5", 6, at(81))).getTime()).toBeGreaterThanOrEqual(ex.getTime());
    await expect(assertNotPaused(db, "c5", at(24 * 100))).rejects.toThrow(/self-exclusion is active/);
    await expect(startCoolOff(db, "c5", 5, t0)).rejects.toThrow(/cool-off length/);
  });

  it("rejects out-of-range limits", async () => {
    await expect(setLimit(db, "c6", "topup:day", 50, t0)).rejects.toThrow(/\$1 to \$10,000/);
    await expect(setLimit(db, "c6", "spend:day", 2_000_000, t0)).rejects.toThrow(/1,000,000/);
  });
});
