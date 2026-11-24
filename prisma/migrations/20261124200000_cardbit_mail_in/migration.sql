-- CreateTable
CREATE TABLE "CardbitMailIn" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "customerId" TEXT,
    "promo" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "receivedOn" TEXT NOT NULL,
    "postmarkedOn" TEXT,
    "region" TEXT,
    "value" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "spinId" TEXT,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardbitMailIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardbitMailIn_shop_ref_key" ON "CardbitMailIn"("shop", "ref");

-- CreateIndex
CREATE INDEX "CardbitMailIn_shop_promo_period_customerId_idx" ON "CardbitMailIn"("shop", "promo", "period", "customerId");
