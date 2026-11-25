CREATE TABLE "SiteSubscription" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'coinflow',
    "providerRef" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "currentPeriodEnd" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SiteSubscription_providerRef_key" ON "SiteSubscription"("providerRef");
CREATE INDEX "SiteSubscription_customerId_status_idx" ON "SiteSubscription"("customerId", "status");
-- At most one live plan per customer.
CREATE UNIQUE INDEX "SiteSubscription_one_live" ON "SiteSubscription"("customerId") WHERE "status" IN ('PENDING', 'ACTIVE', 'PAST_DUE');

CREATE TABLE "SiteSubscriptionPayment" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "cents" INTEGER NOT NULL,
    "paidBits" INTEGER NOT NULL,
    "bonusBits" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREDITED',
    "clawedBits" INTEGER NOT NULL DEFAULT 0,
    "owedBits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteSubscriptionPayment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SiteSubscriptionPayment_paymentId_key" ON "SiteSubscriptionPayment"("paymentId");
CREATE INDEX "SiteSubscriptionPayment_customerId_createdAt_idx" ON "SiteSubscriptionPayment"("customerId", "createdAt");
ALTER TABLE "SiteSubscriptionPayment" ADD CONSTRAINT "SiteSubscriptionPayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "SiteSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
