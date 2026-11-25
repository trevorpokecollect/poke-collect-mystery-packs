-- Cardbit standalone site core tables (only used when CARDBIT_SITE=on)
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "SiteCustomer" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "googleSub" TEXT,
    "name" TEXT,
    "frozenAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteSession" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "SiteSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteEmailCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteEmailCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteWallet" (
    "customerId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteWallet_pkey" PRIMARY KEY ("customerId")
);

-- CreateTable
CREATE TABLE "SiteLedger" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteCopy" (
    "id" TEXT NOT NULL,
    "receiptKey" TEXT NOT NULL,
    "printingKey" TEXT NOT NULL,
    "tcgplayerId" INTEGER,
    "title" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "setName" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "finish" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "image" TEXT,
    "slot" INTEGER,
    "pocket" INTEGER,
    "lookKey" TEXT NOT NULL,
    "faceKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'FOR_SALE',
    "retailBits" INTEGER,
    "ownerId" TEXT,
    "poolSlotId" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteCopy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteCopyEvent" (
    "id" TEXT NOT NULL,
    "copyId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteCopyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteIntakeReceipt" (
    "eventKey" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteIntakeReceipt_pkey" PRIMARY KEY ("eventKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteCustomer_email_key" ON "SiteCustomer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SiteCustomer_googleSub_key" ON "SiteCustomer"("googleSub");

-- CreateIndex
CREATE INDEX "SiteSession_customerId_idx" ON "SiteSession"("customerId");

-- CreateIndex
CREATE INDEX "SiteEmailCode_email_createdAt_idx" ON "SiteEmailCode"("email", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SiteLedger_idempotencyKey_key" ON "SiteLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SiteLedger_customerId_createdAt_idx" ON "SiteLedger"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SiteCopy_receiptKey_key" ON "SiteCopy"("receiptKey");

-- CreateIndex
CREATE UNIQUE INDEX "SiteCopy_poolSlotId_key" ON "SiteCopy"("poolSlotId");

-- CreateIndex
CREATE INDEX "SiteCopy_status_printingKey_idx" ON "SiteCopy"("status", "printingKey");

-- CreateIndex
CREATE INDEX "SiteCopy_ownerId_status_idx" ON "SiteCopy"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SiteCopy_slot_pocket_key" ON "SiteCopy"("slot", "pocket");

-- CreateIndex
CREATE UNIQUE INDEX "SiteCopy_slot_lookKey_key" ON "SiteCopy"("slot", "lookKey");

-- CreateIndex
CREATE UNIQUE INDEX "SiteCopy_slot_faceKey_key" ON "SiteCopy"("slot", "faceKey");

-- CreateIndex
CREATE INDEX "SiteCopyEvent_copyId_createdAt_idx" ON "SiteCopyEvent"("copyId", "createdAt");


ALTER TABLE "SiteWallet" ADD CONSTRAINT "SiteWallet_balance_check" CHECK ("balance" >= 0);
ALTER TABLE "SiteCopy" ADD CONSTRAINT "SiteCopy_status_check" CHECK ("status" IN ('FOR_SALE','POOLED','VAULTED','SHIP_LOCKED','SHIPPED','REMOVED'));
ALTER TABLE "SiteCopy" ADD CONSTRAINT "SiteCopy_slot_check" CHECK ("slot" IS NULL OR "slot" >= 10001);
