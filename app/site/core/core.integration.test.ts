import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { IntakeRejected, SITE_FIRST_SLOT, receiveSiteIntake } from "./stock.server";
import { InsufficientCardbits, balanceOf, postLedger } from "./ledger.server";
import { SignInError, createSession, currentCustomer, issueEmailCode, safeReturn, verifyEmailCode } from "./auth.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const card = (eventKey: string, quantity = 1, extra: Record<string, unknown> = {}) => ({
  eventKey, quantity, title: "Pikachu - 173/165 - Holofoil", game: "pokemon", setName: "Scarlet & Violet 151",
  number: "173/165", name: "Pikachu", finish: "Holofoil", language: "English", condition: "Near Mint", ...extra,
});
const wipe = async () => {
  await db.siteCopyEvent.deleteMany();
  await db.siteCopy.deleteMany();
  await db.siteIntakeReceipt.deleteMany();
  await db.siteLedger.deleteMany();
  await db.siteWallet.deleteMany();
  await db.siteSession.deleteMany();
  await db.siteEmailCode.deleteMany();
  await db.siteCustomer.deleteMany();
};

describe.skipIf(!url)("standalone site core", () => {
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(wipe);
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it("receives copies into slots from 10001, one printing per slot, idempotently", async () => {
    const r = await receiveSiteIntake(db, card("site:1", 3));
    expect(r.received).toBe(3);
    expect(r.copies.map((c) => c.slot)).toEqual([SITE_FIRST_SLOT, SITE_FIRST_SLOT + 1, SITE_FIRST_SLOT + 2]);
    expect(await receiveSiteIntake(db, card("site:1", 3))).toEqual(r);
    expect(await db.siteCopy.count()).toBe(3);
    const other = await receiveSiteIntake(db, card("site:2", 1, { name: "Charmander", number: "004/165", title: "Charmander" }));
    expect(other.copies[0]).toMatchObject({ slot: SITE_FIRST_SLOT, pocket: 2 });
  });

  it("rejects changed replays (409) and bad receipts (422)", async () => {
    await receiveSiteIntake(db, card("site:3"));
    await expect(receiveSiteIntake(db, card("site:3", 2))).rejects.toMatchObject({ status: 409 });
    await expect(receiveSiteIntake(db, card("site:4", 1, { game: "magic" }))).rejects.toBeInstanceOf(IntakeRejected);
    await expect(receiveSiteIntake(db, card("site:5", 0))).rejects.toMatchObject({ status: 422 });
  });

  it("handles concurrent receipts without slot collisions", async () => {
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => receiveSiteIntake(db, card(`site:c${i}`, 1, { name: `Card ${i}`, number: `${i + 10}/100`, title: `Card ${i}` }))),
    );
    const copies = await db.siteCopy.findMany();
    expect(new Set(copies.map((c) => `${c.slot}:${c.pocket}`)).size).toBe(6);
  });

  it("ledger never double-credits and never goes negative", async () => {
    const c = await db.siteCustomer.create({ data: { email: "a@example.com" } });
    await postLedger(db, { customerId: c.id, delta: 1000, kind: "TOPUP", idempotencyKey: "pay:1" });
    const again = await postLedger(db, { customerId: c.id, delta: 1000, kind: "TOPUP", idempotencyKey: "pay:1" });
    expect(again.replay).toBe(true);
    expect(await balanceOf(db, c.id)).toBe(1000);
    await expect(postLedger(db, { customerId: c.id, delta: -1500, kind: "PACK", idempotencyKey: "pack:1" })).rejects.toBeInstanceOf(InsufficientCardbits);
    const spends = await Promise.allSettled(
      [1, 2, 3].map((i) => postLedger(db, { customerId: c.id, delta: -400, kind: "PACK", idempotencyKey: `pack:r${i}` })),
    );
    expect(spends.filter((s) => s.status === "fulfilled")).toHaveLength(2);
    expect(await balanceOf(db, c.id)).toBe(200);
  });

  it("email code signs in once and creates one account per email", async () => {
    const issued = await issueEmailCode(db, " Trevor@Example.com ", null);
    await expect(verifyEmailCode(db, "trevor@example.com", "000000" === issued.code ? "111111" : "000000")).rejects.toBeInstanceOf(SignInError);
    const c = await verifyEmailCode(db, "TREVOR@example.com", issued.code);
    expect(c.email).toBe("trevor@example.com");
    await expect(verifyEmailCode(db, "trevor@example.com", issued.code)).rejects.toBeInstanceOf(SignInError);
    const cookie = await createSession(db, c.id, new Request("https://x/"));
    const token = cookie.split(";")[0].split("=")[1];
    const req = new Request("https://x/", { headers: { cookie: `cb_site=${token}` } });
    expect((await currentCustomer(db, req))?.id).toBe(c.id);
    expect(await currentCustomer(db, new Request("https://x/", { headers: { cookie: "cb_site=nope" } }))).toBeNull();
  });

  it("only allows same-origin return paths", () => {
    expect(safeReturn("https://evil.example/")).toBe("/account");
    expect(safeReturn("//evil.example")).toBe("/account");
    expect(safeReturn("/vault")).toBe("/vault");
  });
});
