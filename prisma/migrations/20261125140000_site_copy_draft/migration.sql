-- Draft listing state (Trevor, Nov 24): Card Broker intake lands copies in DRAFT (hidden from shoppers,
-- the only source for pack pools); staff "Make Active" moves DRAFT -> FOR_SALE singles.
ALTER TABLE "SiteCopy" DROP CONSTRAINT "SiteCopy_status_check";
ALTER TABLE "SiteCopy" ADD CONSTRAINT "SiteCopy_status_check" CHECK ("status" IN ('DRAFT','FOR_SALE','POOLED','VAULTED','SHIP_LOCKED','SHIPPED','REMOVED'));
ALTER TABLE "SiteCopy" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
