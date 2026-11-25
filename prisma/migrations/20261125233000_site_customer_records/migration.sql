ALTER TABLE "SiteCustomer" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "SiteCustomer" ADD COLUMN "staffNote" TEXT;
ALTER TABLE "SiteMarketing" ADD COLUMN "emailSource" TEXT;
ALTER TABLE "SiteMarketing" ADD COLUMN "smsSource" TEXT;
-- Consent recorded before sources existed came from the Welcome Rewards page (the only opt-in so far).
UPDATE "SiteMarketing" SET "emailSource" = 'welcome-rewards' WHERE "emailOptInAt" IS NOT NULL AND ("emailOptOutAt" IS NULL OR "emailOptOutAt" < "emailOptInAt");
UPDATE "SiteMarketing" SET "emailSource" = 'account' WHERE "emailOptOutAt" IS NOT NULL AND ("emailOptInAt" IS NULL OR "emailOptOutAt" >= "emailOptInAt");
UPDATE "SiteMarketing" SET "smsSource" = 'welcome-rewards' WHERE "smsRequestedAt" IS NOT NULL AND ("smsOptOutAt" IS NULL OR "smsOptOutAt" < "smsRequestedAt");
UPDATE "SiteMarketing" SET "smsSource" = 'account' WHERE "smsOptOutAt" IS NOT NULL AND ("smsRequestedAt" IS NULL OR "smsOptOutAt" >= "smsRequestedAt");
CREATE INDEX "SiteCustomer_tags_idx" ON "SiteCustomer" USING GIN ("tags");
