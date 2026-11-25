-- Verified restocks (Trevor, Nov 25): pack pools change only through published, versioned restocks.
ALTER TABLE "SiteCopy" ADD COLUMN "restockId" TEXT;
CREATE INDEX "SiteCopy_restockId_idx" ON "SiteCopy"("restockId");
ALTER TABLE "SiteOpeningFair" ADD COLUMN "poolVersion" INTEGER;

CREATE TABLE "SiteRestock" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STAGED',
    "version" INTEGER,
    "addIds" JSONB NOT NULL DEFAULT '[]',
    "removeIds" JSONB NOT NULL DEFAULT '[]',
    "poolIds" JSONB,
    "poolHash" TEXT,
    "poolSize" INTEGER,
    "tiers" JSONB,
    "note" TEXT,
    "actor" TEXT,
    "liveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteRestock_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SiteRestock_status_check" CHECK ("status" IN ('STAGED','LIVE')),
    CONSTRAINT "SiteRestock_live_check" CHECK ("status" <> 'LIVE' OR ("version" IS NOT NULL AND "poolHash" IS NOT NULL))
);
CREATE UNIQUE INDEX "SiteRestock_packId_version_key" ON "SiteRestock"("packId", "version");
CREATE INDEX "SiteRestock_packId_status_idx" ON "SiteRestock"("packId", "status");
-- At most one open (STAGED) restock per pack.
CREATE UNIQUE INDEX "SiteRestock_one_staged_per_pack" ON "SiteRestock"("packId") WHERE "status" = 'STAGED';
-- A staged copy is either a Draft card waiting to be added or a pooled card waiting to be removed.
ALTER TABLE "SiteCopy" ADD CONSTRAINT "SiteCopy_restock_status_check" CHECK ("restockId" IS NULL OR "status" IN ('DRAFT','POOLED'));

-- EV targets and automatic buyback routing (Trevor, Nov 25). EV is internal only.
ALTER TABLE "SitePack" ADD COLUMN "targetEvPct" INTEGER,
  ADD COLUMN "evBandPct" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "minTopPer100" INTEGER,
  ADD COLUMN "languages" JSONB,
  ADD COLUMN "eras" JSONB;
ALTER TABLE "SiteCopy" ADD COLUMN "autoRestock" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "era" TEXT;
ALTER TABLE "SiteRestock" ADD COLUMN "auto" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "evPct" DOUBLE PRECISION;
-- Pack categories as listed on How It Works (Mystery = Modern/English, Booster = Modern/English/Japanese,
-- Japanese = Modern/Japanese, Gold & Wildcard = any). Targets stay empty until staff set them.
UPDATE "SitePack" SET "languages" = '["English"]', "eras" = '["Modern"]' WHERE "id" = 'cobalt';
UPDATE "SitePack" SET "languages" = '["English","Japanese"]', "eras" = '["Modern"]' WHERE "id" = 'prism';
UPDATE "SitePack" SET "languages" = '["Japanese"]', "eras" = '["Modern"]' WHERE "id" = 'ember';
CREATE INDEX "SiteCopy_autoRestock_idx" ON "SiteCopy"("autoRestock") WHERE "autoRestock";
