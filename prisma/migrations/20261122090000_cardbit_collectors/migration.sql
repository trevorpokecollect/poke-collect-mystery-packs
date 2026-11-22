ALTER TABLE "ShipRequest" ADD COLUMN "quoteKey" TEXT;
CREATE TABLE "CardbitWallet" ("shop" TEXT NOT NULL, "customerId" TEXT NOT NULL, "balance" INTEGER NOT NULL DEFAULT 0 CHECK ("balance" >= 0), "held" BOOLEAN NOT NULL DEFAULT false, PRIMARY KEY ("shop", "customerId"));
CREATE TABLE "CardbitReceipt" ("id" TEXT PRIMARY KEY, "shop" TEXT NOT NULL, "eventKey" TEXT NOT NULL, "customerId" TEXT NOT NULL, "fingerprint" TEXT NOT NULL, "kind" TEXT NOT NULL, "delta" INTEGER NOT NULL, "openingId" TEXT, "copyId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "CardbitReceipt_shop_eventKey_key" ON "CardbitReceipt" ("shop","eventKey");
CREATE INDEX "CardbitReceipt_shop_customerId_createdAt_idx" ON "CardbitReceipt" ("shop","customerId","createdAt");
CREATE TABLE "CardbitBuyback" ("copyId" TEXT PRIMARY KEY REFERENCES "Pull"("id") ON DELETE RESTRICT ON UPDATE CASCADE, "shop" TEXT NOT NULL, "customerId" TEXT NOT NULL, "amount" INTEGER NOT NULL CHECK ("amount" > 0), "expiresAt" TIMESTAMP(3) NOT NULL, "acceptedAt" TIMESTAMP(3));
CREATE INDEX "CardbitBuyback_shop_customerId_idx" ON "CardbitBuyback" ("shop","customerId");
