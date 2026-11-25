-- Shopify-gap audit (Nov 25 2026): staff reversals, order notes, staff audit trail, slab/sealed item data, nexus alerts.
ALTER TABLE "SiteOpening" ADD COLUMN "reversedAt" TIMESTAMP(3);
ALTER TABLE "SiteOpening" ADD COLUMN "reversedBy" TEXT;
ALTER TABLE "SiteOpening" ADD COLUMN "reverseReason" TEXT;

ALTER TABLE "SiteCopy" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'card';
ALTER TABLE "SiteCopy" ADD COLUMN "rarity" TEXT;
ALTER TABLE "SiteCopy" ADD COLUMN "grader" TEXT;
ALTER TABLE "SiteCopy" ADD COLUMN "grade" TEXT;
ALTER TABLE "SiteCopy" ADD COLUMN "certNumber" TEXT;
ALTER TABLE "SiteCopy" ADD COLUMN "sealedType" TEXT;
ALTER TABLE "SiteCopy" ADD COLUMN "weightOz" DOUBLE PRECISION;
ALTER TABLE "SiteCopy" ADD COLUMN "photos" JSONB;

CREATE TABLE "SiteOrderNote" (
    "id" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "orderRef" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteOrderNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SiteOrderNote_orderType_orderRef_createdAt_idx" ON "SiteOrderNote"("orderType", "orderRef", "createdAt");
CREATE INDEX "SiteOrderNote_customerId_createdAt_idx" ON "SiteOrderNote"("customerId", "createdAt");

CREATE TABLE "SiteStaffAction" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "customerId" TEXT,
    "orderType" TEXT,
    "orderRef" TEXT,
    "reason" TEXT,
    "detail" JSONB,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteStaffAction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SiteStaffAction_requestId_key" ON "SiteStaffAction"("requestId");
CREATE INDEX "SiteStaffAction_customerId_createdAt_idx" ON "SiteStaffAction"("customerId", "createdAt");
CREATE INDEX "SiteStaffAction_orderType_orderRef_idx" ON "SiteStaffAction"("orderType", "orderRef");
CREATE INDEX "SiteStaffAction_createdAt_idx" ON "SiteStaffAction"("createdAt");

CREATE TABLE "SiteNexusAlert" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "band" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteNexusAlert_pkey" PRIMARY KEY ("id")
);
