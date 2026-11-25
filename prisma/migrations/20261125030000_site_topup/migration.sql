-- CreateTable
CREATE TABLE "SiteTopup" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "baseBits" INTEGER NOT NULL,
    "bonusBits" INTEGER NOT NULL,
    "cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentId" TEXT,
    "billingState" TEXT NOT NULL,
    "billingZip" TEXT NOT NULL,
    "ip" TEXT,
    "ipRegion" TEXT,
    "clawedBits" INTEGER NOT NULL DEFAULT 0,
    "owedBits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteTopup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "ref" TEXT,
    "payload" JSONB NOT NULL,
    "result" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "SiteWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteTopup_paymentId_key" ON "SiteTopup"("paymentId");
CREATE INDEX "SiteTopup_customerId_createdAt_idx" ON "SiteTopup"("customerId", "createdAt");
ALTER TABLE "SiteTopup" ADD CONSTRAINT "SiteTopup_status_check" CHECK ("status" IN ('PENDING','CREDITED','REFUNDED','CHARGEBACK','CHARGEBACK_WON','CHARGEBACK_LOST'));
