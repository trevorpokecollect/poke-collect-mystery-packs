import type { PrismaClient } from "@prisma/client";

/** Cardbit sells only to collectors 18 or older. Each signed-in customer confirms once per store. */
export const AGE_SOURCES = ["signup", "prompt"] as const;
export type AgeSource = (typeof AGE_SOURCES)[number];

export const AGE_REQUIRED = {
  code: "AGE_REQUIRED",
  error: "Confirm You're 18 or Older to Continue.",
} as const;

type AgeDb = Pick<PrismaClient, "cardbitAgeConfirmation">;

export async function ageConfirmed(db: AgeDb, shop: string, customerId: string) {
  const row = await db.cardbitAgeConfirmation.findUnique({
    where: { shop_customerId: { shop, customerId } },
    select: { confirmedAt: true },
  });
  return row ? row.confirmedAt : null;
}

/** Idempotent: the first confirmation's time and source are kept. */
export async function confirmAge(db: AgeDb, shop: string, customerId: string, source: AgeSource) {
  if (!AGE_SOURCES.includes(source)) throw new Error("Unknown confirmation source.");
  const row = await db.cardbitAgeConfirmation.upsert({
    where: { shop_customerId: { shop, customerId } },
    create: { shop, customerId, source },
    update: {},
    select: { confirmedAt: true },
  });
  return row.confirmedAt;
}
