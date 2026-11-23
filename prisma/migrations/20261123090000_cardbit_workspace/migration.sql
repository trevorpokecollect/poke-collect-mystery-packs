-- AlterTable
ALTER TABLE "CardbitReceipt" ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "balanceAfter" INTEGER,
ADD COLUMN     "qualifyingPaidCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'wallet';

-- CreateTable
CREATE TABLE "CardbitDeskBook" (
    "shop" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "policy" JSONB NOT NULL,
    "actor" TEXT,
    "referenceDate" TEXT,
    "refreshedAt" TIMESTAMP(3),
    "references" JSONB NOT NULL,
    "variants" JSONB NOT NULL,

    CONSTRAINT "CardbitDeskBook_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "CardbitDeskTick" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "bits" INTEGER,
    "market" INTEGER,

    CONSTRAINT "CardbitDeskTick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardbitVaultMark" (
    "shop" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "bits" INTEGER,
    "market" INTEGER,

    CONSTRAINT "CardbitVaultMark_pkey" PRIMARY KEY ("shop","customer","source","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardbitDeskTick_shop_key_at_key" ON "CardbitDeskTick"("shop", "key", "at");
