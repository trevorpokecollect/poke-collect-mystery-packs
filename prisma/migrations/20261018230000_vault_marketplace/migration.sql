-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'CHECKOUT', 'SOLD', 'CANCELLED');

-- AlterTable
ALTER TABLE "Pull" ADD COLUMN     "openToTrade" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "refundFlaggedAt" TIMESTAMP(3),
ADD COLUMN     "transferredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MarketSettings" (
    "shop" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sellingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "feePercent" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketSettings_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "Trader" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tradeName" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trader_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "fromCustomerId" TEXT NOT NULL,
    "toCustomerId" TEXT NOT NULL,
    "status" "TradeStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "counterOfId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeItem" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "pullId" TEXT NOT NULL,
    "side" TEXT NOT NULL,

    CONSTRAINT "TradeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "pullId" TEXT NOT NULL,
    "sellerCustomerId" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "buyerCustomerId" TEXT,
    "draftOrderId" TEXT,
    "invoiceUrl" TEXT,
    "checkoutExpiresAt" TIMESTAMP(3),
    "orderId" TEXT,
    "orderName" TEXT,
    "soldAt" TIMESTAMP(3),
    "payoutStatus" TEXT,
    "payoutAmount" DECIMAL(10,2),
    "payoutDueAt" TIMESTAMP(3),
    "paidOutAt" TIMESTAMP(3),
    "flagReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullTransfer" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "pullId" TEXT NOT NULL,
    "fromCustomerId" TEXT NOT NULL,
    "toCustomerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "tradeId" TEXT,
    "listingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PullTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Trader_shop_customerId_key" ON "Trader"("shop", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Trader_shop_nameKey_key" ON "Trader"("shop", "nameKey");

-- CreateIndex
CREATE INDEX "Trade_shop_status_idx" ON "Trade"("shop", "status");

-- CreateIndex
CREATE INDEX "Trade_fromCustomerId_idx" ON "Trade"("fromCustomerId");

-- CreateIndex
CREATE INDEX "Trade_toCustomerId_idx" ON "Trade"("toCustomerId");

-- CreateIndex
CREATE INDEX "TradeItem_pullId_idx" ON "TradeItem"("pullId");

-- CreateIndex
CREATE INDEX "Listing_shop_status_idx" ON "Listing"("shop", "status");

-- CreateIndex
CREATE INDEX "Listing_pullId_idx" ON "Listing"("pullId");

-- CreateIndex
CREATE INDEX "Listing_sellerCustomerId_idx" ON "Listing"("sellerCustomerId");

-- CreateIndex
CREATE INDEX "Listing_payoutStatus_payoutDueAt_idx" ON "Listing"("payoutStatus", "payoutDueAt");

-- CreateIndex
CREATE INDEX "PullTransfer_pullId_idx" ON "PullTransfer"("pullId");

-- AddForeignKey
ALTER TABLE "TradeItem" ADD CONSTRAINT "TradeItem_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeItem" ADD CONSTRAINT "TradeItem_pullId_fkey" FOREIGN KEY ("pullId") REFERENCES "Pull"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_pullId_fkey" FOREIGN KEY ("pullId") REFERENCES "Pull"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullTransfer" ADD CONSTRAINT "PullTransfer_pullId_fkey" FOREIGN KEY ("pullId") REFERENCES "Pull"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

