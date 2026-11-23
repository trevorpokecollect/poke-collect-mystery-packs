import type { Prisma } from "@prisma/client";

// Both Cardbit draft entry points use the same transaction lock for a Shopify pack variant.
export async function lockPackVariantDraft(
  tx: Prisma.TransactionClient,
  shop: string,
  variantId: string,
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${shop + "/pack-draft/" + variantId}, 0))::text`;
}
