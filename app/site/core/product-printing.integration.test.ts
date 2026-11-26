// Nov 25 2026 (Trevor): regular "Snorlax - 051" copies showed the "Snorlax - 051 (Pokemon Center Exclusive)" price,
// because both TCGplayer products share set, number and finish. Each product is its own printing now.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyBrokerPrice, legacyPrintingKey, priceKey, printingKey, receiveSiteIntake } from "./stock.server";
import { DeskError, listStock, relinkCopy } from "./stock-desk.server";
import { singleKey } from "../store/store.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const base = { game: "pokemon", setName: "SV: Scarlet & Violet Promo Cards", number: "051", finish: "Holofoil", language: "English", condition: "Near Mint" };
const regular = { ...base, name: "Snorlax - 051", title: "Snorlax - 051 · Holofoil (SV: Scarlet & Violet Promo Cards)", tcgplayerId: 517175, image: "https://product-images.tcgplayer.com/fit-in/400x400/517175.jpg" };
const stamped = { ...base, name: "Snorlax - 051 (Pokemon Center Exclusive)", title: "Snorlax - 051 (Pokemon Center Exclusive) · Holofoil (SV: Scarlet & Violet Promo Cards)", tcgplayerId: 517270, image: "https://product-images.tcgplayer.com/fit-in/400x400/517270.jpg" };
const intake = (eventKey: string, card: typeof regular, priceBits: number) => ({ eventKey, quantity: 1, ...card, priceBits, buybackBits: Math.round(priceBits * 0.8) });
const priceOf = async (id: string) => (await listStock(db, { limit: 100 })).copies.find((c) => c.id === id)?.retailBits ?? null;

describe.skipIf(!url)("one printing per TCGplayer product", () => {
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(async () => {
    await db.siteWant.deleteMany();
    await db.sitePrice.deleteMany();
    await db.siteCopyEvent.deleteMany();
    await db.siteRestock.deleteMany();
    await db.siteCopy.deleteMany();
    await db.siteIntakeReceipt.deleteMany();
  });
  afterAll(() => db.$disconnect());

  it("prices the regular promo and the Pokémon Center lookalike separately", async () => {
    expect(printingKey(regular)).not.toBe(printingKey(stamped));
    expect(printingKey({ ...regular, tcgplayerId: null })).toBe(legacyPrintingKey(regular));
    const a = await receiveSiteIntake(db, intake("pp:1", regular, 2150));
    const b = await receiveSiteIntake(db, intake("pp:2", stamped, 26500));
    expect(await priceOf(a.copies[0].id)).toBe(2150);
    expect(await priceOf(b.copies[0].id)).toBe(26500);
    // Card Broker's price feed is per product too.
    await applyBrokerPrice(db, priceKey(printingKey(regular), "Near Mint"), { retailBits: 2200, buybackBits: 1760 });
    expect(await priceOf(a.copies[0].id)).toBe(2200);
    expect(await priceOf(b.copies[0].id)).toBe(26500);
  });

  it("switches a copy listed under the wrong product, keeping its slot", async () => {
    const r = await receiveSiteIntake(db, intake("pp:3", stamped, 26500));
    const id = r.copies[0].id;
    await expect(relinkCopy(db, "t", id, { ...regular, number: "052" })).rejects.toThrow(DeskError);
    const out = await relinkCopy(db, "t", id, regular);
    expect(out).toMatchObject({ switched: true, printingKey: printingKey(regular) });
    const c = await db.siteCopy.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ tcgplayerId: 517175, name: "Snorlax - 051", slot: r.copies[0].slot, pocket: r.copies[0].pocket });
    expect(await priceOf(id)).toBeNull(); // the stamped price does not follow it; Card Broker prices it next
    expect((await db.siteCopyEvent.findMany({ where: { copyId: id } })).some((e) => /switched product/.test(e.reason ?? ""))).toBe(true);
    expect(await relinkCopy(db, "t", id, regular)).toMatchObject({ switched: false });
  });

  it("migration re-keys old copies; prices carry over only where one product owns the old key", async () => {
    // Copies stored before the fix used the set/number/finish/language key.
    const old = legacyPrintingKey(regular);
    const mk = (n: number, card: typeof regular, extra: Record<string, unknown> = {}) =>
      db.siteCopy.create({ data: { receiptKey: `old:${n}`, printingKey: old, tcgplayerId: card.tcgplayerId, title: card.title, game: card.game, setName: card.setName, number: card.number, name: card.name, finish: card.finish, language: card.language, condition: "Near Mint", lookKey: `lk${n}`, faceKey: `fk${n}`, ...extra } });
    const r1 = await mk(1, regular);
    await mk(2, stamped, { status: "REMOVED" }); // a deleted wrong pick still counts as sharing the key
    const pika = { ...regular, setName: "Other Set", name: "Pikachu", tcgplayerId: 1234 };
    const pOld = legacyPrintingKey(pika);
    const p1 = await db.siteCopy.create({ data: { receiptKey: "old:3", printingKey: pOld, tcgplayerId: 1234, title: "Pikachu", game: "pokemon", setName: "Other Set", number: "051", name: "Pikachu", finish: "Holofoil", language: "English", condition: "Near Mint", lookKey: "lk3", faceKey: "fk3" } });
    await db.sitePrice.createMany({ data: [{ printingKey: priceKey(old, "Near Mint"), retailBits: 26500, buybackBits: 21200, source: "cardbroker" }, { printingKey: priceKey(pOld, "Near Mint"), retailBits: 300, buybackBits: 240, source: "cardbroker" }] });
    await db.siteWant.create({ data: { customerId: "cust1", cardKey: singleKey({ printingKey: pOld, condition: "Near Mint" }) } });

    const sql = readFileSync(new URL("../../../prisma/migrations/20261126003000_site_product_printing_key/migration.sql", import.meta.url), "utf8");
    const statements = sql.replace(/^--.*$/gm, "").split(/;\s*$/m).map((s) => s.trim()).filter(Boolean);
    await db.$transaction(async (tx) => {
      for (const s of statements) await tx.$executeRawUnsafe(s);
    });

    expect((await db.siteCopy.findUniqueOrThrow({ where: { id: r1.id } })).printingKey).toBe(printingKey(regular));
    expect((await db.siteCopy.findUniqueOrThrow({ where: { id: p1.id } })).printingKey).toBe(printingKey(pika));
    expect(await priceOf(r1.id)).toBeNull(); // shared key: waits for Card Broker's price sync
    expect(await priceOf(p1.id)).toBe(300); // one product: price kept
    expect((await db.siteWant.findFirstOrThrow({ where: { customerId: "cust1" } })).cardKey).toBe(singleKey({ printingKey: printingKey(pika), condition: "Near Mint" }));
  });
});
