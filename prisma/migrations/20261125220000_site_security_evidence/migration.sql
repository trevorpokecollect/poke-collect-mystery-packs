-- Chargeback evidence on site top-ups and Terms acceptance on site customers.
ALTER TABLE "SiteTopup" ADD COLUMN "deviceId" TEXT;
ALTER TABLE "SiteTopup" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "SiteCustomer" ADD COLUMN "termsVersion" TEXT;
ALTER TABLE "SiteCustomer" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
-- Risk review: flagged top-ups pause shipping until staff clear the account.
ALTER TABLE "SiteCustomer" ADD COLUMN "riskStatus" TEXT NOT NULL DEFAULT 'ok';
ALTER TABLE "SiteCustomer" ADD COLUMN "riskNote" TEXT;
ALTER TABLE "SiteTopup" ADD COLUMN "riskLevel" TEXT;
ALTER TABLE "SiteTopup" ADD COLUMN "riskReasons" JSONB;
