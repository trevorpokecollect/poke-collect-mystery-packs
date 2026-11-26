-- Redeem codes (Poke-Collect Black Friday and later campaigns): single-use codes that add promotional Cardbits.
CREATE TABLE "SiteRedeemCampaign" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bits" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteRedeemCampaign_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "SiteRedeemCode" (
    "code" TEXT NOT NULL,
    "compact" TEXT NOT NULL,
    "campaign" TEXT NOT NULL,
    "batch" TEXT NOT NULL,
    "redeemedBy" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteRedeemCode_pkey" PRIMARY KEY ("code")
);

CREATE UNIQUE INDEX "SiteRedeemCode_compact_key" ON "SiteRedeemCode"("compact");
CREATE UNIQUE INDEX "SiteRedeemCode_campaign_redeemedBy_key" ON "SiteRedeemCode"("campaign", "redeemedBy");
CREATE INDEX "SiteRedeemCode_campaign_createdAt_idx" ON "SiteRedeemCode"("campaign", "createdAt");

-- The Poke-Collect Black Friday campaign: 1,000 Cardbits per code. Expiry is set by staff in Card Broker once the
-- launch date is known (null until then = no end date shown).
INSERT INTO "SiteRedeemCampaign" ("key", "name", "bits", "active", "note", "updatedAt")
VALUES ('PCBF', 'Poke-Collect Black Friday', 1000, true, 'Poke-Collect orders of $200+ after discounts, Nov 27-30 2026 (Central), once per customer', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
