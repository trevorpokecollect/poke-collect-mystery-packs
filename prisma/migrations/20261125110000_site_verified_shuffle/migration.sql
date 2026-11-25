CREATE TABLE "SiteFairSeed" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL DEFAULT 0,
    "revealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteFairSeed_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SiteFairSeed_customerId_revealedAt_idx" ON "SiteFairSeed"("customerId", "revealedAt");
-- One active (unrevealed) seed per customer.
CREATE UNIQUE INDEX "SiteFairSeed_one_active" ON "SiteFairSeed"("customerId") WHERE "revealedAt" IS NULL;

CREATE TABLE "SiteOpeningFair" (
    "openingId" TEXT NOT NULL,
    "seedId" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL,
    "poolIds" JSONB NOT NULL,
    "pickIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteOpeningFair_pkey" PRIMARY KEY ("openingId")
);
CREATE INDEX "SiteOpeningFair_seedId_idx" ON "SiteOpeningFair"("seedId");
ALTER TABLE "SiteOpeningFair" ADD CONSTRAINT "SiteOpeningFair_openingId_fkey" FOREIGN KEY ("openingId") REFERENCES "SiteOpening"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteOpeningFair" ADD CONSTRAINT "SiteOpeningFair_seedId_fkey" FOREIGN KEY ("seedId") REFERENCES "SiteFairSeed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
