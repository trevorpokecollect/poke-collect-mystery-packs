ALTER TABLE "SitePack" ADD COLUMN "tierRules" JSONB;
ALTER TABLE "SiteOpening" ADD COLUMN "revealedAt" TIMESTAMP(3);
UPDATE "SiteOpening" SET "revealedAt" = "createdAt" WHERE "sealed" = false;
CREATE INDEX "SiteOpening_revealedAt_idx" ON "SiteOpening"("revealedAt");
