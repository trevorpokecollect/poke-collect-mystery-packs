import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { receiveSiteIntake } from "./stock.server";
import { DeskError, listStock, movePool, setListing, setPrice } from "./stock-desk.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const card = (eventKey: string, quantity: number, name: string) => ({
  eventKey, quantity, title: `${name} - 2/100`, game: "pokemon", setName: "Desk Set", number: "2/100",
  name, finish: "Normal", language: "English", condition: "Near Mint",
});

describe.skipIf(!url)("stock desk", () => {
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(async () => {
    await db.sitePrice.deleteMany();
    await db.siteCopyEvent.deleteMany();
    await db.siteCopy.deleteMany();
    await db.siteIntakeReceipt.deleteMany();
  });
  afterAll(() => db.$disconnect());

  it("lists with totals and cursor, prices printings, moves pools", async () => {
    await receiveSiteIntake(db, card("desk:1", 3, "Oddish"));
    const first = await listStock(db, { limit: 2 });
    expect(first.copies).toHaveLength(2);
    expect(first.next).toBeTruthy();
    expect(first.totals).toMatchObject({ all: 3, DRAFT: 3 });
    const rest = await listStock(db, { limit: 2, cursor: first.next! });
    expect(rest.copies).toHaveLength(1);
    expect(rest.next).toBeNull();
    expect(first.copies[0]).not.toHaveProperty("ownerId");

    await expect(setPrice(db, "t", first.copies[0].printingKey, "Near Mint", 100, 200)).rejects.toThrow(DeskError);
    await setPrice(db, "t", first.copies[0].printingKey, "near mint", 300, 150);
    await expect(setPrice(db, "t", first.copies[0].printingKey, "Damaged", 300, 150)).rejects.toThrow(DeskError);
    expect((await listStock(db, {})).copies.every((c) => c.retailBits === 300 && c.buybackBits === 150)).toBe(true);

    const ids = first.copies.map((c) => c.id);
    expect(await movePool(db, "t", ids, "cobalt")).toEqual({ moved: 2, skipped: 0 });
    expect((await listStock(db, { status: "POOLED" })).total).toBe(2);
    expect(await movePool(db, "t", ids, null)).toEqual({ moved: 2, skipped: 0 });
    expect((await listStock(db, { q: "oddish", status: "DRAFT" })).total).toBe(3);
    expect(await setListing(db, "t", ids, true)).toEqual({ moved: 2, skipped: 0 });
    expect(await movePool(db, "t", ids, "cobalt")).toEqual({ moved: 0, skipped: 2 }); // pools fill from Draft only
    expect((await listStock(db, { status: "FOR_SALE" })).total).toBe(2);
    expect(await setListing(db, "t", ids, false)).toEqual({ moved: 2, skipped: 0 });
  });
});
