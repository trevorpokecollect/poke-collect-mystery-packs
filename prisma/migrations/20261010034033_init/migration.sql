-- CreateEnum
CREATE TYPE "SeriesStatus" AS ENUM ('DRAFT', 'LIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "PullStatus" AS ENUM ('UNOPENED', 'REVEALED', 'FULFILLING', 'VOIDED');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Series" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "status" "SeriesStatus" NOT NULL DEFAULT 'DRAFT',
    "packProductId" TEXT NOT NULL,
    "packVariantId" TEXT NOT NULL,
    "packPrice" DECIMAL(10,2) NOT NULL,
    "autoOpenDays" INTEGER NOT NULL DEFAULT 7,
    "commitHash" TEXT,
    "salt" TEXT,
    "launchedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "tier" TEXT NOT NULL,
    "marketValue" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Slot" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "position" INTEGER,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "voided" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pull" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "packIndex" INTEGER NOT NULL,
    "customerId" TEXT,
    "status" "PullStatus" NOT NULL DEFAULT 'UNOPENED',
    "revealedAt" TIMESTAMP(3),
    "autoOpened" BOOLEAN NOT NULL DEFAULT false,
    "fulfillingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pull_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackOrder" (
    "orderId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "customerId" TEXT,
    "openToken" TEXT NOT NULL,
    "held" BOOLEAN NOT NULL DEFAULT false,
    "cardsAddedAt" TIMESTAMP(3),
    "finalizingAt" TIMESTAMP(3),
    "finalized" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackOrder_pkey" PRIMARY KEY ("orderId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Series_packVariantId_key" ON "Series"("packVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "Series_shop_handle_key" ON "Series"("shop", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "Card_seriesId_variantId_key" ON "Card"("seriesId", "variantId");

-- CreateIndex
CREATE INDEX "Slot_seriesId_claimed_voided_idx" ON "Slot"("seriesId", "claimed", "voided");

-- CreateIndex
CREATE UNIQUE INDEX "Slot_seriesId_position_key" ON "Slot"("seriesId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Pull_slotId_key" ON "Pull"("slotId");

-- CreateIndex
CREATE INDEX "Pull_orderId_idx" ON "Pull"("orderId");

-- CreateIndex
CREATE INDEX "Pull_customerId_idx" ON "Pull"("customerId");

-- CreateIndex
CREATE INDEX "Pull_status_createdAt_idx" ON "Pull"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Pull_lineItemId_packIndex_key" ON "Pull"("lineItemId", "packIndex");

-- CreateIndex
CREATE UNIQUE INDEX "PackOrder_openToken_key" ON "PackOrder"("openToken");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slot" ADD CONSTRAINT "Slot_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slot" ADD CONSTRAINT "Slot_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pull" ADD CONSTRAINT "Pull_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pull" ADD CONSTRAINT "Pull_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
