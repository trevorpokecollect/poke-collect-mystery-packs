-- Draw rule 2 (Nov 27 2026): a pack never holds two copies of the same printing.
ALTER TABLE "SiteOpeningFair" ADD COLUMN "drawRule" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SiteOpeningFair" ADD COLUMN "poolGroups" JSONB;
-- Every seed in use was committed under rule 1. Reveal them so each customer's next opening uses a fresh
-- seed committed after rule 2 was published (their past openings can now be verified).
UPDATE "SiteFairSeed" SET "revealedAt" = now() WHERE "revealedAt" IS NULL;
