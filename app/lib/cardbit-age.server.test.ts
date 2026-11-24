import { describe, expect, it } from "vitest";
import { ageConfirmed, confirmAge } from "./cardbit-age.server";

function fakeDb() {
  const rows = new Map<string, { source: string; confirmedAt: Date }>();
  const key = (w: { shop: string; customerId: string }) => w.shop + "|" + w.customerId;
  return {
    rows,
    cardbitAgeConfirmation: {
      findUnique: async ({ where }: any) => rows.get(key(where.shop_customerId)) ?? null,
      upsert: async ({ where, create }: any) => {
        const k = key(where.shop_customerId);
        if (!rows.has(k)) rows.set(k, { source: create.source, confirmedAt: new Date() });
        return rows.get(k)!;
      },
    },
  } as any;
}

describe("Cardbit 18+ confirmation", () => {
  it("is unconfirmed until the customer confirms", async () => {
    const db = fakeDb();
    expect(await ageConfirmed(db, "hhuuev-81.myshopify.com", "gid://shopify/Customer/1")).toBeNull();
    await confirmAge(db, "hhuuev-81.myshopify.com", "gid://shopify/Customer/1", "signup");
    expect(await ageConfirmed(db, "hhuuev-81.myshopify.com", "gid://shopify/Customer/1")).toBeInstanceOf(Date);
  });

  it("keeps the first confirmation and scopes it to store and customer", async () => {
    const db = fakeDb();
    const first = await confirmAge(db, "a.myshopify.com", "gid://shopify/Customer/1", "signup");
    const again = await confirmAge(db, "a.myshopify.com", "gid://shopify/Customer/1", "prompt");
    expect(again).toBe(first);
    expect(db.rows.get("a.myshopify.com|gid://shopify/Customer/1").source).toBe("signup");
    expect(await ageConfirmed(db, "b.myshopify.com", "gid://shopify/Customer/1")).toBeNull();
    expect(await ageConfirmed(db, "a.myshopify.com", "gid://shopify/Customer/2")).toBeNull();
  });

  it("rejects unknown sources", async () => {
    await expect(confirmAge(fakeDb(), "a", "c", "other" as any)).rejects.toThrow();
  });
});
