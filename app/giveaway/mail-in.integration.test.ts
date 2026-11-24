import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { weeklyStandings } from "../lib/cardbit-leaderboard.server";
import { logMailIn } from "./mail-in.server";

const url = process.env.TEST_DATABASE_URL;
const a = "gid://shopify/Customer/501",
  b = "gid://shopify/Customer/502",
  c = "gid://shopify/Customer/503";
const db = new PrismaClient({
  datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } },
});
const card = (ref: string, receivedOn: string) => ({
  promo: "leaderboard",
  ref,
  receivedOn,
  region: "TX",
  adult: true,
});

describe.skipIf(!url)("Mail-in leaderboard points", () => {
  beforeAll(async () => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "ignore",
    });
    vi.stubEnv("CARDBIT_STOREFRONT_SHOP", shop);
  });
  afterAll(async () => {
    await db.cardbitMailIn.deleteMany({ where: { shop, ref: { startsWith: "MI-2026121" } } });
    await db.cardbitReceipt.deleteMany({ where: { shop, eventKey: { startsWith: "mailin-qa:" } } });
    await db.$disconnect();
    vi.unstubAllEnvs();
  });

  it("refuses while the leaderboard is off, then adds 1,000 points per postcard up to 7 a week, with ties to whoever got there first", async () => {
    const monday = new Date("2026-12-14T15:00:00Z");
    vi.stubEnv("CARDBIT_LEADERBOARD", "off");
    await expect(
      logMailIn(db, "staff", card("MI-20261214-001", "2026-12-14"), a, monday),
    ).rejects.toThrow("not open");
    vi.stubEnv("CARDBIT_LEADERBOARD", "on");
    // b spends 2,000 Cardbits on packs on Monday morning.
    await db.cardbitReceipt.create({
      data: {
        shop,
        customerId: b,
        eventKey: "mailin-qa:b",
        fingerprint: "qa",
        kind: "pack",
        delta: -2000,
        createdAt: new Date("2026-12-14T14:00:00Z"),
      },
    });
    for (let i = 1; i <= 8; i++) {
      const row = await logMailIn(
        db,
        "staff",
        card("MI-20261214-00" + i, "2026-12-14"),
        a,
        new Date(monday.getTime() + i * 60000),
      );
      expect(row.status).toBe(i <= 7 ? "accepted" : "rejected");
    }
    // c reaches 2,000 later than b via two postcards.
    await logMailIn(db, "staff", card("MI-20261215-001", "2026-12-15"), c, new Date("2026-12-15T15:00:00Z"));
    await logMailIn(db, "staff", card("MI-20261215-002", "2026-12-15"), c, new Date("2026-12-15T16:00:00Z"));
    const week = await weeklyStandings(db, shop, c, new Date("2026-12-16T12:00:00Z"));
    expect(week.top.map((r) => r.score)).toEqual([7000, 2000, 2000]);
    expect(week.top[2].you).toBe(true);
    expect(week.you).toEqual({ rank: 3, score: 2000 });
    // The next week starts from zero.
    const next = await weeklyStandings(db, shop, a, new Date("2026-12-22T12:00:00Z"));
    expect(next.you).toBe(null);
  });
});
