import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ALPHABET, compactCode, generateCodes, listCampaigns, listCodes, newCode, previewCode, redeemCode, saveCampaign, voidCodes } from "./redeem-codes.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });

describe("code format", () => {
  it("makes PREFIX-XXXXXXXX from the look-alike-free alphabet and matches entries loosely", () => {
    const c = newCode("PCBF");
    expect(c).toMatch(new RegExp(`^PCBF-[${ALPHABET}]{8}$`));
    expect(ALPHABET).not.toMatch(/[01OIL]/);
    expect(compactCode(" pcbf-ab cd-2345 ")).toBe("PCBFABCD2345");
  });
});

describe.skipIf(!url)("redeem codes", () => {
  let a = "";
  let b = "";
  const cust = (id: string) => ({ id, frozenAt: null, closedAt: null });
  const balance = async (id: string) => (await db.siteWallet.findUnique({ where: { customerId: id } }))?.balance ?? 0;

  beforeAll(async () => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(async () => {
    a = (await db.siteCustomer.upsert({ where: { email: "redeem-a@example.com" }, update: {}, create: { email: "redeem-a@example.com" } })).id;
    b = (await db.siteCustomer.upsert({ where: { email: "redeem-b@example.com" }, update: {}, create: { email: "redeem-b@example.com" } })).id;
    await db.siteLedger.deleteMany({ where: { customerId: { in: [a, b] } } });
    await db.siteWallet.deleteMany({ where: { customerId: { in: [a, b] } } });
    await db.siteRedeemCode.deleteMany({ where: { campaign: "PCBF" } });
    await db.siteRedeemCampaign.update({ where: { key: "PCBF" }, data: { active: true, expiresAt: null, bits: 1000 } });
  });
  afterAll(async () => {
    await db.siteLedger.deleteMany({ where: { customerId: { in: [a, b] } } });
    await db.siteWallet.deleteMany({ where: { customerId: { in: [a, b] } } });
    await db.siteRedeemCode.deleteMany({ where: { campaign: "PCBF" } });
    await db.$disconnect();
  });

  it("the migration seeds the PCBF campaign at 1,000 Cardbits", async () => {
    const [c] = (await listCampaigns(db)).filter((x) => x.key === "PCBF");
    expect(c).toMatchObject({ name: "Poke-Collect Black Friday", bits: 1000, active: true });
  });

  it("generates unique codes and credits 1,000 promotional Cardbits once", async () => {
    const { codes } = await generateCodes(db, "pcbf", 150, "staff@example.com");
    expect(codes).toHaveLength(150);
    expect(new Set(codes).size).toBe(150);
    const r = await redeemCode(db, cust(a), codes[0].toLowerCase().replace("-", " "));
    expect(r).toMatchObject({ code: codes[0], bits: 1000, already: false });
    expect(await balance(a)).toBe(1000);
    const led = await db.siteLedger.findFirstOrThrow({ where: { customerId: a } });
    expect(led).toMatchObject({ kind: "BONUS", delta: 1000, ref: "redeem:PCBF" });
    // Same customer again: no second credit.
    expect((await redeemCode(db, cust(a), codes[0])).already).toBe(true);
    expect(await balance(a)).toBe(1000);
    // Another customer can't use it.
    await expect(redeemCode(db, cust(b), codes[0])).rejects.toThrow("Already Been Used");
    // One PCBF code per account.
    await expect(redeemCode(db, cust(a), codes[1])).rejects.toThrow("One Per Account");
    expect(await balance(a)).toBe(1000);
    const list = await listCodes(db, "PCBF", { status: "redeemed" });
    expect(list.codes).toEqual([expect.objectContaining({ code: codes[0], email: "redeem-a@example.com", status: "Redeemed" })]);
    const [c] = (await listCampaigns(db)).filter((x) => x.key === "PCBF");
    expect(c).toMatchObject({ codes: 150, redeemed: 1, bitsGiven: 1000 });
  });

  it("two codes at once for one account: only one credits", async () => {
    const { codes } = await generateCodes(db, "PCBF", 2, null);
    const results = await Promise.allSettled([redeemCode(db, cust(a), codes[0]), redeemCode(db, cust(a), codes[1])]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await balance(a)).toBe(1000);
  });

  it("one code raced by two accounts: only one credits", async () => {
    const { codes } = await generateCodes(db, "PCBF", 1, null);
    const results = await Promise.allSettled([redeemCode(db, cust(a), codes[0]), redeemCode(db, cust(b), codes[0])]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await balance(a)) + (await balance(b))).toBe(1000);
  });

  it("refuses unknown, voided, expired, paused codes and frozen accounts", async () => {
    const { codes } = await generateCodes(db, "PCBF", 3, null);
    await expect(redeemCode(db, cust(a), "PCBF-ZZZZZZZZ")).rejects.toThrow("Isn't Valid");
    expect(await voidCodes(db, [codes[0]])).toEqual({ voided: 1 });
    await expect(redeemCode(db, cust(a), codes[0])).rejects.toThrow("Isn't Valid");
    await expect(redeemCode(db, { id: a, frozenAt: new Date(), closedAt: null }, codes[1])).rejects.toThrow("Can't Redeem");
    await saveCampaign(db, { key: "PCBF", expiresAt: "2027-01-31T23:59:59-06:00" });
    expect((await previewCode(db, codes[1]))?.expiresAt?.toISOString()).toBe("2027-02-01T05:59:59.000Z");
    await expect(redeemCode(db, cust(a), codes[1], new Date("2027-02-02T00:00:00Z"))).rejects.toThrow("Expired on January 31, 2027 at 11:59 PM CT");
    await saveCampaign(db, { key: "PCBF", active: false });
    await expect(redeemCode(db, cust(a), codes[1])).rejects.toThrow("Isn't Active");
    await saveCampaign(db, { key: "PCBF", active: true });
    expect((await redeemCode(db, cust(a), codes[1], new Date("2027-01-15T00:00:00Z"))).already).toBe(false);
    // Cardbits per code can't change once a code is redeemed; redeemed codes can't be voided.
    await expect(saveCampaign(db, { key: "PCBF", bits: 500 })).rejects.toThrow("can't change");
    expect(await voidCodes(db, [codes[1]])).toEqual({ voided: 0 });
  });
});
