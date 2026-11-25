import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HandoffError, redeemHandoff, startHandoff, validChallenge, validVerifier } from "./app-handoff.server";
import { currentCustomer } from "./auth.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const verifier = "v".repeat(20) + "-._~" + "a1B2c3D4e5F6g7H8i9J0k";
const challenge = createHash("sha256").update(verifier).digest("base64url");
const req = () => new Request("https://site.test/api/app/session", { headers: { "user-agent": "Cardbit/0.3" } });

describe("app hand-off input checks", () => {
  it("accepts only S256-shaped challenges and RFC 7636 verifiers", () => {
    expect(validChallenge(challenge)).toBe(true);
    expect(validChallenge("short")).toBe(false);
    expect(validChallenge(challenge + "=")).toBe(false);
    expect(validVerifier(verifier)).toBe(true);
    expect(validVerifier("x".repeat(42))).toBe(false);
    expect(validVerifier("x".repeat(129))).toBe(false);
    expect(validVerifier(42)).toBe(false);
  });
});

describe.skipIf(!url)("app hand-off", () => {
  let customerId = "";
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(async () => {
    await db.siteAppHandoff.deleteMany();
    await db.siteSession.deleteMany();
    await db.siteCustomer.deleteMany({ where: { email: "app-handoff@test.cardbit" } });
    customerId = (await db.siteCustomer.create({ data: { email: "app-handoff@test.cardbit" } })).id;
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("trades code + verifier for a working session, once", async () => {
    const { code, redirect } = await startHandoff(db, customerId, challenge);
    expect(redirect).toBe(`cardbit://signed-in?code=${code}`);
    const { token } = await redeemHandoff(db, code, verifier, req());
    const asCookie = new Request("https://site.test/", { headers: { cookie: `cb_site=${token}` } });
    expect((await currentCustomer(db, asCookie))?.id).toBe(customerId);
    await expect(redeemHandoff(db, code, verifier, req())).rejects.toBeInstanceOf(HandoffError);
  });

  it("rejects a wrong verifier, an expired code and a closed account", async () => {
    const a = await startHandoff(db, customerId, challenge);
    await expect(redeemHandoff(db, a.code, "w".repeat(43), req())).rejects.toBeInstanceOf(HandoffError);
    const b = await startHandoff(db, customerId, challenge);
    await db.siteAppHandoff.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(redeemHandoff(db, b.code, verifier, req())).rejects.toBeInstanceOf(HandoffError);
    const c = await startHandoff(db, customerId, challenge);
    await db.siteCustomer.update({ where: { id: customerId }, data: { closedAt: new Date() } });
    await expect(redeemHandoff(db, c.code, verifier, req())).rejects.toBeInstanceOf(HandoffError);
  });

  it("gives a code to exactly one of two simultaneous redeemers", async () => {
    const { code } = await startHandoff(db, customerId, challenge);
    const results = await Promise.allSettled([redeemHandoff(db, code, verifier, req()), redeemHandoff(db, code, verifier, req())]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.siteSession.count({ where: { customerId } })).toBe(1);
  });
});
