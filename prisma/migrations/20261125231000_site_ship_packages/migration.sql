-- Saved shipping packages + the package/weight a label was bought with.
CREATE TABLE "SiteShipPackage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'MAILER',
    "lengthIn" DOUBLE PRECISION NOT NULL,
    "widthIn" DOUBLE PRECISION NOT NULL,
    "heightIn" DOUBLE PRECISION NOT NULL,
    "weightOz" DOUBLE PRECISION NOT NULL,
    "maxCards" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteShipPackage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SiteShipPackage_active_maxCards_idx" ON "SiteShipPackage"("active", "maxCards");

ALTER TABLE "SiteShipment" ADD COLUMN "packageId" TEXT;
ALTER TABLE "SiteShipment" ADD COLUMN "weightOz" DOUBLE PRECISION;
ALTER TABLE "SiteShipment" ADD COLUMN "parcel" JSONB;
