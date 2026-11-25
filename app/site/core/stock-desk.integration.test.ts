import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { receiveSiteIntake } from "./stock.server";
import { DeskError, boxSummary, listStock, moveToSlot, movePool, removeCopies, setListing, setPrice } from "./stock-desk.server";
import { publishRestock } from "./restock.server";

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
    await db.siteRestock.deleteMany();
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
    // Pools change only through published restocks: "pool" stages, publish applies.
    expect(await movePool(db, "t", ids, "cobalt")).toMatchObject({ moved: 2, skipped: 0 });
    expect((await listStock(db, { status: "POOLED" })).total).toBe(0);
    expect(await setListing(db, "t", ids, true)).toEqual({ moved: 0, skipped: 2 }); // staged copies are locked
    await publishRestock(db, "t", "cobalt");
    expect((await listStock(db, { status: "POOLED" })).total).toBe(2);
    expect(await movePool(db, "t", ids, null)).toMatchObject({ moved: 2, skipped: 0 });
    expect((await listStock(db, { status: "POOLED" })).total).toBe(2); // still in the pool until publish
    await publishRestock(db, "t", "cobalt");
    expect((await listStock(db, { q: "oddish", status: "DRAFT" })).total).toBe(3);
    expect(await setListing(db, "t", ids, true)).toEqual({ moved: 2, skipped: 0 });
    expect(await movePool(db, "t", ids, "cobalt")).toMatchObject({ moved: 0, skipped: 2 }); // pools fill from Draft only
    expect((await listStock(db, { status: "FOR_SALE" })).total).toBe(2);
    expect(await setListing(db, "t", ids, false)).toEqual({ moved: 2, skipped: 0 });
  });

  it("deletes only unsold Draft/Active copies, frees the pocket, logs it, and hides them from All", async () => {
    const r = await receiveSiteIntake(db, card("del:1", 4, "Bellsprout"));
    const [a, b, c, d] = r.copies.map((x) => x.id);
    await setListing(db, "t", [b], true);
    await db.siteCopy.update({ where: { id: c }, data: { status: "VAULTED", ownerId: "cust" } });
    await movePool(db, "t", [d], "cobalt"); // staged for a restock
    const out = await removeCopies(db, "card-broker:emily", [a, b, c, d, "nope"], "Listed twice");
    expect(out).toMatchObject({ removed: 2, missing: 1, skipped: 3 });
    expect(Object.fromEntries(out.blocked.map((x) => [x.id, x.reason]))).toEqual({ [c]: "in a customer's vault", [d]: "staged for a restock (unstage it first)" });
    const gone = await db.siteCopy.findUnique({ where: { id: a } });
    expect(gone).toMatchObject({ status: "REMOVED", slot: null, pocket: null });
    const ev = await db.siteCopyEvent.findFirst({ where: { copyId: b, toStatus: "REMOVED" } });
    expect(ev).toMatchObject({ fromStatus: "FOR_SALE", actor: "card-broker:emily" });
    expect(ev!.reason).toMatch(/^deleted: Listed twice \(was slot 1000\d pocket \d+\)$/);
    const all = await listStock(db, {});
    expect(all.copies.map((x) => x.id).sort()).toEqual([c, d].sort());
    expect(all.totals).toMatchObject({ all: 2, REMOVED: 2 });
    expect((await listStock(db, { status: "REMOVED" })).total).toBe(2);
    expect((await removeCopies(db, "t", [a], "")).blocked[0].reason).toBe("already deleted");
    await expect(removeCopies(db, "t", [], "x")).rejects.toThrow(DeskError);
  });

  it("moves a copy to a chosen slot and pocket, keeping one card per name per slot", async () => {
    const [x] = (await receiveSiteIntake(db, card("mv:1", 1, "Pidgey"))).copies;
    const [y] = (await receiveSiteIntake(db, { ...card("mv:2", 1, "Rattata"), number: "9/100", title: "Rattata - 9/100" })).copies;
    const [z] = (await receiveSiteIntake(db, { ...card("mv:3", 1, "Pidgey"), number: "3/100", title: "Pidgey - 3/100" })).copies;
    expect(x.slot).toBe(10001);
    expect(z.slot).toBe(10002); // Pidgey can't share slot 10001
    expect(await moveToSlot(db, "card-broker:momo", y.id, 10050, null)).toMatchObject({ slot: 10050, pocket: 1, moved: true });
    expect(await moveToSlot(db, "t", x.id, 10050, 5)).toMatchObject({ slot: 10050, pocket: 5 });
    await expect(moveToSlot(db, "t", z.id, 10050, null)).rejects.toThrow("Shelf 1 · Box 1 · Row 2 · Slot 20 already holds a Pidgey");
    await expect(moveToSlot(db, "t", z.id, 10051, 0)).rejects.toThrow("Card position must be 1");
    await expect(moveToSlot(db, "t", z.id, 500, null)).rejects.toThrow("Choose a Box, Row and Slot");
    await moveToSlot(db, "t", z.id, 10060, 3);
    await expect(moveToSlot(db, "t", y.id, 10060, 3)).rejects.toThrow("Card 3 in Shelf 1 · Box 1 · Row 2 · Slot 30 is taken");
    const ev = await db.siteCopyEvent.findFirst({ where: { copyId: x.id, reason: { startsWith: "moved" } } });
    expect(ev).toMatchObject({ actor: "t", reason: "moved from slot 10001 pocket 1 to slot 10050 pocket 5", fromStatus: "DRAFT", toStatus: "DRAFT" });
    await db.siteCopy.update({ where: { id: z.id }, data: { status: "SHIP_LOCKED" } });
    await expect(moveToSlot(db, "t", z.id, 10070, null)).rejects.toThrow("locked for a shipment");
  });

  it("receives into a claimed box or row only, refuses when it's full, and reports cards per row", async () => {
    // Row 2 of box 1 = slots 10031..10060.
    const r = await receiveSiteIntake(db, { ...card("claim:1", 2, "Zubat"), firstSlot: 10031, lastSlot: 10060, area: "Box 1 · Row 2" });
    expect(r.copies.map((c) => c.slot)).toEqual([10031, 10032]); // one Zubat per slot
    const b2 = await receiveSiteIntake(db, { ...card("claim:2", 1, "Golbat"), firstSlot: 10151, lastSlot: 10300, area: "Box 2" });
    expect(b2.copies[0].slot).toBe(10151);
    await expect(receiveSiteIntake(db, { ...card("claim:3", 3, "Onix"), firstSlot: 10001, lastSlot: 10002, area: "Test Row" })).rejects.toThrow("Test Row has no room");
    expect(await db.siteCopy.count({ where: { name: "Onix" } })).toBe(0);
    await expect(receiveSiteIntake(db, { ...card("claim:4", 1, "Onix"), firstSlot: 500, lastSlot: 520 })).rejects.toThrow("Invalid slot range");
    expect(await boxSummary(db)).toEqual([
      { box: 1, row: 2, cards: 2, slotsUsed: 2 },
      { box: 2, row: 1, cards: 1, slotsUsed: 1 },
    ]);
  });
});
