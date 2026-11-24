-- CreateTable
CREATE TABLE "CardbitSparkWallet" (
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CardbitSparkWallet_pkey" PRIMARY KEY ("shop","customerId")
);

-- CreateTable
CREATE TABLE "CardbitSparkTxn" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "source" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardbitSparkTxn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardbitSparkTxn_shop_eventKey_key" ON "CardbitSparkTxn"("shop", "eventKey");

-- CreateIndex
CREATE INDEX "CardbitSparkTxn_shop_customerId_createdAt_idx" ON "CardbitSparkTxn"("shop", "customerId", "createdAt");
