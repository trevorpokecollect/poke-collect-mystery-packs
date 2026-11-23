-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'ENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('SIGNUP', 'REFERRAL', 'SOCIAL_FOLLOW', 'VISIT_URL', 'DAILY_CHECKIN', 'SECRET_CODE', 'ALTERNATE_ENTRY', 'CUSTOM', 'POLL', 'QUESTION', 'WATCH_VIDEO', 'SOCIAL_SHARE', 'SMS_OPTIN');

-- CreateEnum
CREATE TYPE "EntrantStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'HELD', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "EntrySource" AS ENUM ('ACTION', 'PURCHASE', 'REFERRAL', 'ADJUSTMENT', 'ROLLBACK', 'IMPORT');

-- CreateEnum
CREATE TYPE "OrderLogStatus" AS ENUM ('ENTRIES', 'NO_ENTRIES', 'NO_USER', 'ROLLED_BACK_EDIT', 'ROLLED_BACK_CANCELLED');

-- CreateEnum
CREATE TYPE "DailyPrizeStatus" AS ENUM ('RESERVED', 'DRAWN', 'SENT', 'RELEASED');

-- CreateTable
CREATE TABLE "CardbitGiveawayConfig" (
    "shop" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rulesUrl" TEXT NOT NULL DEFAULT '',
    "freeInstructions" TEXT NOT NULL DEFAULT '',
    "referralEntries" INTEGER NOT NULL DEFAULT 500,
    "shareEntries" INTEGER NOT NULL DEFAULT 100,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardbitGiveawayConfig_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "CardbitGiveawayPerson" (
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "referredBy" TEXT,
    "whatnotAt" TIMESTAMP(3),
    "region" TEXT NOT NULL,
    "ageConfirmedAt" TIMESTAMP(3) NOT NULL,
    "held" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CardbitGiveawayPerson_pkey" PRIMARY KEY ("shop","customerId")
);

-- CreateTable
CREATE TABLE "CardbitGiveawayRound" (
    "shop" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "seed" TEXT NOT NULL,
    "commitment" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "winnerId" TEXT,
    "participantCount" INTEGER NOT NULL DEFAULT 0,
    "totalEntries" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB,
    "snapshotHash" TEXT,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "CardbitGiveawayRound_pkey" PRIMARY KEY ("shop","day")
);

-- CreateTable
CREATE TABLE "CardbitGiveawayEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entries" INTEGER NOT NULL,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "actor" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardbitGiveawayEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardbitGiveawayAudit" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardbitGiveawayAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "prize" TEXT,
    "imageUrl" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "purchaseRules" JSONB,
    "riskPolicy" JSONB,
    "theme" JSONB,
    "settings" JSONB,
    "rulesText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntryAction" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "type" "ActionType" NOT NULL,
    "label" TEXT NOT NULL,
    "entries" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "repeatable" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntryAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionResponse" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "entrantId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entrant" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "name" TEXT,
    "shopifyCustomerId" TEXT,
    "status" "EntrantStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "verifiedAt" TIMESTAMP(3),
    "referralCode" TEXT NOT NULL,
    "referredById" TEXT,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "ipHash" TEXT,
    "subnetHash" TEXT,
    "deviceHash" TEXT,
    "userAgent" TEXT,
    "utm" JSONB,
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "discountCode" TEXT,
    "klaviyoSyncedAt" TIMESTAMP(3),
    "phone" TEXT,
    "smsConsentAt" TIMESTAMP(3),
    "existingCustomer" BOOLEAN,
    "emailWasSubscribed" BOOLEAN,
    "smsWasSubscribed" BOOLEAN,
    "listsCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntryEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "entrantId" TEXT NOT NULL,
    "source" "EntrySource" NOT NULL,
    "actionId" TEXT,
    "orderLogId" TEXT,
    "entries" INTEGER NOT NULL,
    "note" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLog" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderName" TEXT,
    "email" TEXT,
    "status" "OrderLogStatus" NOT NULL,
    "entries" INTEGER NOT NULL DEFAULT 0,
    "breakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskSignal" (
    "id" TEXT NOT NULL,
    "entrantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailOtp" (
    "id" TEXT NOT NULL,
    "entrantId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitHit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Draw" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "seed" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "totalEntries" INTEGER NOT NULL,
    "eligibleCount" INTEGER NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Draw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Winner" (
    "id" TEXT NOT NULL,
    "drawId" TEXT NOT NULL,
    "entrantId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "forfeited" BOOLEAN NOT NULL DEFAULT false,
    "claimedAt" TIMESTAMP(3),
    "claimData" JSONB,
    "prizeOrderId" TEXT,
    "prizeOrderName" TEXT,

    CONSTRAINT "Winner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignImage" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "actor" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPrize" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "drawAt" TIMESTAMP(3) NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productHandle" TEXT,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "reservedFrom" TEXT NOT NULL DEFAULT 'available',
    "items" JSONB,
    "status" "DailyPrizeStatus" NOT NULL DEFAULT 'RESERVED',
    "drawId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyPrize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyQueueItem" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "position" INTEGER NOT NULL,
    "pinnedDate" TEXT,
    "bundle" JSONB,
    "usedAt" TIMESTAMP(3),
    "prizeId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowClickDay" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "giveaway" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowClickDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppValue" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppValue_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardbitGiveawayPerson_code_key" ON "CardbitGiveawayPerson"("code");

-- CreateIndex
CREATE INDEX "CardbitGiveawayRound_shop_closedAt_closesAt_idx" ON "CardbitGiveawayRound"("shop", "closedAt", "closesAt");

-- CreateIndex
CREATE INDEX "CardbitGiveawayEvent_shop_day_customerId_idx" ON "CardbitGiveawayEvent"("shop", "day", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CardbitGiveawayEvent_shop_key_key" ON "CardbitGiveawayEvent"("shop", "key");

-- CreateIndex
CREATE INDEX "CardbitGiveawayAudit_shop_createdAt_idx" ON "CardbitGiveawayAudit"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "Campaign_shop_status_idx" ON "Campaign"("shop", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_shop_slug_key" ON "Campaign"("shop", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ActionResponse_actionId_entrantId_key" ON "ActionResponse"("actionId", "entrantId");

-- CreateIndex
CREATE UNIQUE INDEX "Entrant_referralCode_key" ON "Entrant"("referralCode");

-- CreateIndex
CREATE INDEX "Entrant_campaignId_status_idx" ON "Entrant"("campaignId", "status");

-- CreateIndex
CREATE INDEX "Entrant_campaignId_ipHash_idx" ON "Entrant"("campaignId", "ipHash");

-- CreateIndex
CREATE INDEX "Entrant_campaignId_subnetHash_idx" ON "Entrant"("campaignId", "subnetHash");

-- CreateIndex
CREATE INDEX "Entrant_campaignId_deviceHash_idx" ON "Entrant"("campaignId", "deviceHash");

-- CreateIndex
CREATE INDEX "Entrant_campaignId_phone_idx" ON "Entrant"("campaignId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Entrant_campaignId_emailNormalized_key" ON "Entrant"("campaignId", "emailNormalized");

-- CreateIndex
CREATE INDEX "EntryEvent_entrantId_idx" ON "EntryEvent"("entrantId");

-- CreateIndex
CREATE UNIQUE INDEX "EntryEvent_campaignId_dedupeKey_key" ON "EntryEvent"("campaignId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLog_campaignId_shopifyOrderId_key" ON "OrderLog"("campaignId", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "RiskSignal_entrantId_idx" ON "RiskSignal"("entrantId");

-- CreateIndex
CREATE INDEX "EmailOtp_entrantId_idx" ON "EmailOtp"("entrantId");

-- CreateIndex
CREATE INDEX "RateLimitHit_key_createdAt_idx" ON "RateLimitHit"("key", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_shop_createdAt_idx" ON "AuditLog"("shop", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPrize_drawId_key" ON "DailyPrize"("drawId");

-- CreateIndex
CREATE INDEX "DailyPrize_campaignId_periodKey_idx" ON "DailyPrize"("campaignId", "periodKey");

-- CreateIndex
CREATE INDEX "DailyPrize_status_drawAt_idx" ON "DailyPrize"("status", "drawAt");

-- CreateIndex
CREATE INDEX "DailyQueueItem_campaignId_usedAt_position_idx" ON "DailyQueueItem"("campaignId", "usedAt", "position");

-- CreateIndex
CREATE INDEX "FollowClickDay_date_idx" ON "FollowClickDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX "FollowClickDay_shop_date_giveaway_platform_key" ON "FollowClickDay"("shop", "date", "giveaway", "platform");

-- AddForeignKey
ALTER TABLE "EntryAction" ADD CONSTRAINT "EntryAction_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionResponse" ADD CONSTRAINT "ActionResponse_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "EntryAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionResponse" ADD CONSTRAINT "ActionResponse_entrantId_fkey" FOREIGN KEY ("entrantId") REFERENCES "Entrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entrant" ADD CONSTRAINT "Entrant_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entrant" ADD CONSTRAINT "Entrant_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "Entrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryEvent" ADD CONSTRAINT "EntryEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryEvent" ADD CONSTRAINT "EntryEvent_entrantId_fkey" FOREIGN KEY ("entrantId") REFERENCES "Entrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryEvent" ADD CONSTRAINT "EntryEvent_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "EntryAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryEvent" ADD CONSTRAINT "EntryEvent_orderLogId_fkey" FOREIGN KEY ("orderLogId") REFERENCES "OrderLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLog" ADD CONSTRAINT "OrderLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskSignal" ADD CONSTRAINT "RiskSignal_entrantId_fkey" FOREIGN KEY ("entrantId") REFERENCES "Entrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailOtp" ADD CONSTRAINT "EmailOtp_entrantId_fkey" FOREIGN KEY ("entrantId") REFERENCES "Entrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draw" ADD CONSTRAINT "Draw_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Winner" ADD CONSTRAINT "Winner_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "Draw"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Winner" ADD CONSTRAINT "Winner_entrantId_fkey" FOREIGN KEY ("entrantId") REFERENCES "Entrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPrize" ADD CONSTRAINT "DailyPrize_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPrize" ADD CONSTRAINT "DailyPrize_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "Draw"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyQueueItem" ADD CONSTRAINT "DailyQueueItem_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
