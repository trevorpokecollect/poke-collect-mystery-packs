import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleCoinflowEvent } from "../payments/coinflow.server";
import { riskLevel, type RiskOutcome } from "../payments/risk.server";
import { clientIp } from "../region.server";
import { staffUser } from "../shipping/staff.server";
import { GuardRefused, assertShipAllowed, assertSignInRate, assertTopupAllowed, resetRateLimits, takeToken } from "./guard.server";
import { applyLedger } from "./ledger.server";
import { checkLedger } from "./ledger-check.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const env = { SITE_STAFF_EMAILS: "staff@cardbit.test" } as NodeJS.ProcessEnv;

describe("security rules (pure)", () => {
  it("scores risk: strong or 3 medium = highest, 2 medium or processor elevated = elevated", () => {
    const m = (code: string) => ({ code, weight: "medium" as const });
    expect(riskLevel([])).toBe("normal");
    expect(riskLevel([m("state_mismatch")])).toBe("normal");
    expect(riskLevel([m("a"), m("b")])).toBe("elevated");
    expect(riskLevel([m("processor_elevated")])).toBe("elevated");
    expect(riskLevel([m("a"), m("b"), m("c")])).toBe("highest");
    expect(riskLevel([{ code: "shared_device", weight: "strong" }])).toBe("highest");
  });
  it("uses Railway's X-Real-IP over a client-supplied X-Forwarded-For", () => {
    expect(clientIp(new Request("https://x/", { headers: { "x-forwarded-for": "1.2.3.4, 9.9.9.9", "x-real-ip": "9.9.9.9" } }))).toBe("9.9.9.9");
    expect(clientIp(new Request("https://x/", { headers: { "x-forwarded-for": "1.2.3.4" } }))).toBe("1.2.3.4");
    expect(clientIp(new Request("https://x/"))).toBeNull();
  });
  it("rate limits per minute and per hour", () => {
    resetRateLimits();
    const lim = { perMinute: 2, perHour: 3 };
    expect(takeToken("k", lim, 0)).toBe(true);
    expect(takeToken("k", lim, 1)).toBe(true);
    expect(takeToken("k", lim, 2)).toBe(false);
    expect(takeToken("k", lim, 61_000)).toBe(true);
    expect(takeToken("k", lim, 122_000)).toBe(false);
  });
  it("staff tools need a recent sign-in", async () => {
    const e = { CARDBIT_SITE: "on", SITE_STAFF_EMAILS: "ops@cardbit.test" } as NodeJS.ProcessEnv;
    const req = new Request("https://site.test/staff/stock?x=1");
    const fresh = async () => ({ id: "u", email: "ops@cardbit.test", signedInAt: new Date() });
    const old = async () => ({ id: "u", email: "ops@cardbit.test", signedInAt: new Date(Date.now() - 13 * 3_600_000) });
    expect(await staffUser(req, fresh, e)).toEqual({ id: "u", email: "ops@cardbit.test" });
    const thrown = await staffUser(req, old, e).catch((x) => x);
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("location")).toBe("/sign-in?fresh=1&return_to=%2Fstaff%2Fstock%3Fx%3D1");
    expect(await staffUser(req, async () => ({ id: "u", email: "someone@cardbit.test", signedInAt: new Date() }), e)).toBeNull();
  });
});

describe.skipIf(!url)("security (database)", () => {
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  const wipe = async () => {
    await db.siteWebhookEvent.deleteMany();
    await db.siteTopup.deleteMany();
    await db.siteLedger.deleteMany();
    await db.siteWallet.deleteMany();
    await db.siteEmailCode.deleteMany();
    await db.siteCustomer.deleteMany();
  };
  beforeEach(async () => {
    resetRateLimits();
    await wipe();
  });
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  const topup = (customerId: string, extra: Record<string, unknown> = {}) =>
    db.siteTopup.create({ data: { customerId, baseBits: 1000, bonusBits: 0, cents: 1000, billingState: "TX", billingZip: "75001", ip: "8.8.8.8", ipRegion: "TX", ...extra } });
  const settle = (t: { id: string; customerId: string; cents: number }, risk?: { level: string }, riskAlert = vi.fn<(t: unknown, email: string, o: RiskOutcome) => Promise<void>>(async () => {})) =>
    handleCoinflowEvent({ db, riskAlert }, { eventType: "Settled", data: { id: `pay-${t.id}`, subtotal: { cents: t.cents, currency: "USD" }, webhookInfo: { topupId: t.id, customerId: t.customerId }, risk } }).then((r) => ({ r, riskAlert }));

  it("a normal top-up credits with no review", async () => {
    const c = await db.siteCustomer.create({ data: { email: "ok@cardbit.test", createdAt: new Date(Date.now() - 30 * 864e5) } });
    const t = await topup(c.id);
    const { r, riskAlert } = await settle(t);
    expect(r).toBe("credited");
    expect((await db.siteTopup.findUniqueOrThrow({ where: { id: t.id } })).riskLevel).toBe("normal");
    expect((await db.siteCustomer.findUniqueOrThrow({ where: { id: c.id } })).riskStatus).toBe("ok");
    expect(riskAlert).toHaveBeenCalledWith(expect.anything(), "ok@cardbit.test", expect.objectContaining({ action: "none" }));
    await expect(assertShipAllowed(db, c.id, env)).resolves.toBeUndefined();
  });

  it("processor 'elevated' pauses shipping and alerts; 'highest' also freezes", async () => {
    const a = await db.siteCustomer.create({ data: { email: "a@cardbit.test" } });
    const { riskAlert } = await settle(await topup(a.id), { level: "elevated" });
    const ca = await db.siteCustomer.findUniqueOrThrow({ where: { id: a.id } });
    expect(ca.riskStatus).toBe("review");
    expect(ca.frozenAt).toBeNull();
    expect(riskAlert.mock.calls[0]![2]).toMatchObject({ level: "elevated", action: "review" });
    const refused = await assertShipAllowed(db, a.id, env).catch((e) => e);
    expect(refused).toBeInstanceOf(GuardRefused);
    expect(refused.code).toBe("ship_hold");
    // Cardbits still credited: spending stays open.
    expect((await db.siteWallet.findUniqueOrThrow({ where: { customerId: a.id } })).balance).toBe(1000);

    const b = await db.siteCustomer.create({ data: { email: "b@cardbit.test" } });
    await settle(await topup(b.id, { ip: "7.7.7.7" }), { level: "highest" });
    const cb = await db.siteCustomer.findUniqueOrThrow({ where: { id: b.id } });
    expect(cb.riskStatus).toBe("review");
    expect(cb.frozenAt).not.toBeNull();
  });

  it("a device shared by 3 accounts is highest risk; trusted and staff accounts are never auto-flagged", async () => {
    const [x, y] = await Promise.all([db.siteCustomer.create({ data: { email: "x@cardbit.test" } }), db.siteCustomer.create({ data: { email: "y@cardbit.test" } })]);
    await topup(x.id, { deviceId: "dev-1" });
    await topup(y.id, { deviceId: "dev-1" });
    const z = await db.siteCustomer.create({ data: { email: "z@cardbit.test" } });
    const { riskAlert } = await settle(await topup(z.id, { deviceId: "dev-1" }));
    expect(riskAlert.mock.calls[0]![2]).toMatchObject({ level: "highest", action: "freeze" });

    const trusted = await db.siteCustomer.create({ data: { email: "t@cardbit.test", riskStatus: "trusted" } });
    await settle(await topup(trusted.id, { deviceId: "dev-1" }));
    expect((await db.siteCustomer.findUniqueOrThrow({ where: { id: trusted.id } })).frozenAt).toBeNull();
  });

  it("state mismatch plus a big first top-up on a brand-new account adds up to a review", async () => {
    const c = await db.siteCustomer.create({ data: { email: "new@cardbit.test" } });
    const t = await db.siteTopup.create({ data: { customerId: c.id, baseBits: 50000, bonusBits: 5000, cents: 50000, billingState: "TX", billingZip: "75001", ip: "6.6.6.6", ipRegion: "FL" } });
    const { riskAlert } = await settle(t);
    // new_account_big + first_topup_big + state_mismatch = 3 medium → highest
    expect(riskAlert.mock.calls[0]![2].signals.map((s) => s.code).sort()).toEqual(["first_topup_big", "new_account_big", "state_mismatch"]);
    expect(riskAlert.mock.calls[0]![2].level).toBe("highest");
  });

  it("top-up caps are off unless SITE_TOPUP_CAPS=on", async () => {
    const c = await db.siteCustomer.create({ data: { email: "cap@cardbit.test" } });
    await expect(assertTopupAllowed(db, c, 50_000, env)).resolves.toBeUndefined();
    await expect(assertTopupAllowed(db, c, 50_000, { ...env, SITE_TOPUP_CAPS: "on" })).rejects.toBeInstanceOf(GuardRefused);
  });

  it("limits sign-in codes per connection", async () => {
    for (let i = 0; i < 20; i++) await db.siteEmailCode.create({ data: { email: `p${i}@cardbit.test`, codeHash: "x", expiresAt: new Date(Date.now() + 6e5), ip: "5.5.5.5" } });
    await expect(assertSignInRate(db, "5.5.5.5", env)).rejects.toBeInstanceOf(GuardRefused);
    await expect(assertSignInRate(db, "5.5.5.6", env)).resolves.toBeUndefined();
    await expect(assertSignInRate(db, "5.5.5.5", { ...env, SITE_GUARD: "log" })).resolves.toBeUndefined();
  });

  it("nightly check passes clean wallets and catches a tampered balance", async () => {
    const c = await db.siteCustomer.create({ data: { email: "l@cardbit.test" } });
    await db.$transaction((tx) => applyLedger(tx, { customerId: c.id, delta: 500, kind: "ADJUST", idempotencyKey: "l1" }));
    await db.$transaction((tx) => applyLedger(tx, { customerId: c.id, delta: -200, kind: "PACK", idempotencyKey: "l2" }));
    expect((await checkLedger(db)).problems).toEqual([]);
    await db.siteWallet.update({ where: { customerId: c.id }, data: { balance: 9999 } });
    const r = await checkLedger(db);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatchObject({ email: "l@cardbit.test", wallet: 9999, ledgerSum: 300 });
  });
});
