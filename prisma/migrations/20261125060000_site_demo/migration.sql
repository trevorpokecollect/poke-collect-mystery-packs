-- Demo stock for the standalone site (staff Demo panel). Additive; Wipe Demo deletes these rows.
ALTER TABLE "SiteCopy" ADD COLUMN "demo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SiteOpening" ADD COLUMN "demo" BOOLEAN NOT NULL DEFAULT false;
