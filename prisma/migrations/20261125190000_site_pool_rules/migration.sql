-- Pool rules and auto-scaling tiers (Trevor, Nov 25): value range, mix caps, fixed tier mix by rank.
ALTER TABLE "SitePack" ADD COLUMN "minValueBits" INTEGER,
  ADD COLUMN "maxValueBits" INTEGER,
  ADD COLUMN "typeCaps" JSONB,
  ADD COLUMN "tierMix" JSONB,
  ADD COLUMN "topTierMin" INTEGER,
  ADD COLUMN "tiersAt" TIMESTAMP(3);
ALTER TABLE "SiteCopy" ADD COLUMN "pulledTier" TEXT;
ALTER TABLE "SiteRestock" ADD COLUMN "tierRules" JSONB;
