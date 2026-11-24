-- CreateTable
CREATE TABLE "CardbitRiskProfile" (
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "accountCreatedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardbitRiskProfile_pkey" PRIMARY KEY ("shop","customerId")
);

-- CreateTable
CREATE TABLE "CardbitRiskSignal" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "valueHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardbitRiskSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardbitGuardEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT,
    "action" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "detail" TEXT,
    "enforced" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardbitGuardEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardbitRiskProfile_shop_status_idx" ON "CardbitRiskProfile"("shop", "status");
CREATE UNIQUE INDEX "CardbitRiskSignal_shop_kind_valueHash_customerId_key" ON "CardbitRiskSignal"("shop", "kind", "valueHash", "customerId");
CREATE INDEX "CardbitRiskSignal_shop_kind_valueHash_idx" ON "CardbitRiskSignal"("shop", "kind", "valueHash");
CREATE INDEX "CardbitGuardEvent_shop_createdAt_idx" ON "CardbitGuardEvent"("shop", "createdAt");
CREATE INDEX "CardbitGuardEvent_shop_customerId_idx" ON "CardbitGuardEvent"("shop", "customerId");
