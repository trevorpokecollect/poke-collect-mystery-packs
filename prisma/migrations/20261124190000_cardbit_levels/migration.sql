-- CreateTable
CREATE TABLE "CardbitProfile" (
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "iconId" TEXT,
    "iconColor" TEXT,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "lastCheckInDay" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardbitProfile_pkey" PRIMARY KEY ("shop","customerId")
);

-- CreateTable
CREATE TABLE "CardbitXpEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "xp" INTEGER NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardbitXpEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardbitXpEvent_shop_eventKey_key" ON "CardbitXpEvent"("shop", "eventKey");

-- CreateIndex
CREATE INDEX "CardbitXpEvent_shop_customerId_createdAt_idx" ON "CardbitXpEvent"("shop", "customerId", "createdAt");
