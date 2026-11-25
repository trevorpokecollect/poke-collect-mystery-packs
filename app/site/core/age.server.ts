// 18+ confirmation for standalone-site customers. Rows live in CardbitAgeConfirmation under the
// site's shop key (same key as SITE_REWARDS_SHOP in app/lib/cardbit-flags.server.ts).
import type { PrismaClient } from "@prisma/client";
import { ageConfirmed, confirmAge, type AgeSource } from "../../lib/cardbit-age.server";

export const SITE_AGE_SHOP = "cardbit-site";

type Db = Pick<PrismaClient, "cardbitAgeConfirmation">;
export const siteAgeConfirmed = (db: Db, customerId: string) => ageConfirmed(db, SITE_AGE_SHOP, customerId);
export const confirmSiteAge = (db: Db, customerId: string, source: AgeSource) => confirmAge(db, SITE_AGE_SHOP, customerId, source);

/** A sign-in that came with the 18+ box ticked records "signup" (kept only if it's the first). */
export async function recordSignupAge(db: Db, customerId: string, ticked: boolean) {
  if (!ticked) return;
  try {
    await confirmSiteAge(db, customerId, "signup");
  } catch (e) {
    console.warn("[site] age confirmation failed", (e as Error).message);
  }
}
