-- AlterTable
ALTER TABLE "MarketSettings" ADD COLUMN     "creditCollectionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "creditCombines" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CreditTxn" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "kind" TEXT NOT NULL,
    "listingId" TEXT,
    "codeId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTxn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditCode" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "discountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "orderId" TEXT,
    "orderName" TEXT,
    "usedAmount" DECIMAL(10,2),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditTxn_shop_customerId_idx" ON "CreditTxn"("shop", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditCode_code_key" ON "CreditCode"("code");

-- CreateIndex
CREATE INDEX "CreditCode_shop_customerId_idx" ON "CreditCode"("shop", "customerId");

-- CreateIndex
CREATE INDEX "CreditCode_status_expiresAt_idx" ON "CreditCode"("status", "expiresAt");

