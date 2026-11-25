ALTER TABLE "SiteCopy" ADD COLUMN "packId" TEXT, ADD COLUMN "openingId" TEXT, ADD COLUMN "position" INTEGER;
CREATE INDEX "SiteCopy_packId_status_idx" ON "SiteCopy"("packId", "status");

CREATE TABLE "SitePack" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priceBits" INTEGER NOT NULL,
    "cardsPerPack" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SitePack_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SitePack_price_check" CHECK ("priceBits" > 0 AND "cardsPerPack" BETWEEN 1 AND 20)
);

CREATE TABLE "SiteOpening" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "priceBits" INTEGER NOT NULL,
    "sealed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteOpening_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SiteOpening_customerId_createdAt_idx" ON "SiteOpening"("customerId", "createdAt");

CREATE TABLE "SitePrice" (
    "printingKey" TEXT NOT NULL,
    "retailBits" INTEGER,
    "buybackBits" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'staff',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SitePrice_pkey" PRIMARY KEY ("printingKey"),
    CONSTRAINT "SitePrice_bits_check" CHECK (("retailBits" IS NULL OR "retailBits" > 0) AND ("buybackBits" IS NULL OR "buybackBits" > 0))
);

CREATE TABLE "SiteWant" (
    "customerId" TEXT NOT NULL,
    "cardKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteWant_pkey" PRIMARY KEY ("customerId", "cardKey")
);

CREATE TABLE "SiteRequest" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteRequest_pkey" PRIMARY KEY ("id")
);

-- Pack editions start inactive; staff fills pools and turns them on. Prices match the Shopify drafts (100 Cardbits = $1).
INSERT INTO "SitePack" ("id","title","priceBits","cardsPerPack","active","sortOrder","updatedAt") VALUES
  ('cobalt','Mystery Pack',1000,1,false,1,CURRENT_TIMESTAMP),
  ('prism','Booster Pack',1299,5,false,2,CURRENT_TIMESTAMP),
  ('gold','Gold Pack',3899,1,false,3,CURRENT_TIMESTAMP),
  ('ember','Japanese Pack',999,1,false,4,CURRENT_TIMESTAMP),
  ('amethyst','Wildcard Pack',499,1,false,5,CURRENT_TIMESTAMP);
