-- CreateTable
CREATE TABLE "CardbitSpin" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "prizeKind" TEXT NOT NULL,
    "amount" INTEGER,
    "pullId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardbitSpin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardbitSpin_pullId_key" ON "CardbitSpin"("pullId");

-- CreateIndex
CREATE UNIQUE INDEX "CardbitSpin_shop_customerId_day_key" ON "CardbitSpin"("shop", "customerId", "day");
