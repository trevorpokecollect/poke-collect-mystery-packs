import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSession, currentCustomer } from "./auth.server";
import { SITE_AGE_SHOP, recordSignupAge, siteAgeConfirmed } from "./age.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });

describe.skipIf(!url)("site sessions and 18+ confirmation", () => {
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(async () => {
    await db.cardbitAgeConfirmation.deleteMany({ where: { shop: SITE_AGE_SHOP } });
    await db.siteSession.deleteMany();
    await db.siteCustomer.deleteMany({ where: { email: "roll@example.com" } });
  });
  afterAll(async () => { await db.$disconnect(); });

  it("rolls the session out to 90 days on use, at most once a day", async () => {
    const c = await db.siteCustomer.create({ data: { email: "roll@example.com" } });
    const cookie = await createSession(db, c.id, new Request("https://x/"));
    expect(cookie).toMatch(/Max-Age=34560000/); // ~400 days; the server expiry is what counts
    const token = cookie.split(";")[0];
    const req = new Request("https://x/", { headers: { cookie: token } });
    const [s] = await db.siteSession.findMany({ where: { customerId: c.id } });
    expect(Math.round((s.expiresAt.getTime() - Date.now()) / 864e5)).toBe(90);
    // 40 days left: the next request pushes it back to 90.
    await db.siteSession.update({ where: { id: s.id }, data: { expiresAt: new Date(Date.now() + 40 * 864e5) } });
    expect((await currentCustomer(db, req))?.id).toBe(c.id);
    const after = await db.siteSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(Math.round((after.expiresAt.getTime() - Date.now()) / 864e5)).toBe(90);
    // Expired sessions stay expired.
    await db.siteSession.update({ where: { id: s.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await currentCustomer(db, req)).toBeNull();
  });

  it("records a ticked sign-up once and keeps the first source", async () => {
    const c = await db.siteCustomer.create({ data: { email: "roll@example.com" } });
    await recordSignupAge(db, c.id, false);
    expect(await siteAgeConfirmed(db, c.id)).toBeNull();
    await recordSignupAge(db, c.id, true);
    const first = await siteAgeConfirmed(db, c.id);
    expect(first).toBeInstanceOf(Date);
    await recordSignupAge(db, c.id, true);
    expect(await siteAgeConfirmed(db, c.id)).toEqual(first);
    const row = await db.cardbitAgeConfirmation.findFirstOrThrow({ where: { shop: SITE_AGE_SHOP, customerId: c.id } });
    expect(row.source).toBe("signup");
  });
});
