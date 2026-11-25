-- Coming-soon waitlist and Founding Collector bonus (Nov 25 2026).
CREATE TABLE "SiteWaitlist" (
    "id" TEXT NOT NULL,
    "emailKey" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "smsConsentAt" TIMESTAMP(3),
    "emailConsentAt" TIMESTAMP(3) NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "source" JSONB,
    "customerId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "emailBonusAt" TIMESTAMP(3),
    "smsBonusAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "smsSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteWaitlist_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SiteWaitlist_emailKey_key" ON "SiteWaitlist"("emailKey");
CREATE UNIQUE INDEX "SiteWaitlist_phone_key" ON "SiteWaitlist"("phone");
CREATE UNIQUE INDEX "SiteWaitlist_customerId_key" ON "SiteWaitlist"("customerId");
CREATE INDEX "SiteWaitlist_ip_createdAt_idx" ON "SiteWaitlist"("ip", "createdAt");
CREATE INDEX "SiteWaitlist_syncedAt_idx" ON "SiteWaitlist"("syncedAt");
