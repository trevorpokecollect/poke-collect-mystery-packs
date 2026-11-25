ALTER TABLE "SiteTopup" ADD COLUMN "promoCode" TEXT;
ALTER TABLE "SiteTopup" ADD COLUMN "promoBits" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "SiteTopup_promoCode_idx" ON "SiteTopup"("promoCode") WHERE "promoCode" IS NOT NULL;

CREATE TABLE "SitePromoCode" (
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "maxBonusBits" INTEGER,
    "maxUses" INTEGER,
    "minCents" INTEGER,
    "firstTopupOnly" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SitePromoCode_pkey" PRIMARY KEY ("code")
);
