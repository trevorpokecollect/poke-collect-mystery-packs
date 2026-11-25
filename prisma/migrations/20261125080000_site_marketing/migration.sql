-- Site marketing consent (Welcome Rewards, Daily Giveaway email requirement). Additive only.
CREATE TABLE "SiteMarketing" (
    "customerId" TEXT NOT NULL,
    "emailOptInAt" TIMESTAMP(3),
    "emailOptOutAt" TIMESTAMP(3),
    "smsPhone" TEXT,
    "smsRequestedAt" TIMESTAMP(3),
    "smsConfirmedAt" TIMESTAMP(3),
    "smsOptOutAt" TIMESTAMP(3),
    "termsVersion" TEXT,
    "ip" TEXT,
    "syncedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteMarketing_pkey" PRIMARY KEY ("customerId")
);
CREATE UNIQUE INDEX "SiteMarketing_smsPhone_key" ON "SiteMarketing"("smsPhone");
