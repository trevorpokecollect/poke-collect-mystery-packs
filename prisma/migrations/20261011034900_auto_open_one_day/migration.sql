-- Unopened packs now open themselves after 1 day instead of 7, so orders aren't held.
ALTER TABLE "Series" ALTER COLUMN "autoOpenDays" SET DEFAULT 1;
UPDATE "Series" SET "autoOpenDays" = 1 WHERE "autoOpenDays" = 7;
