-- How each cardbit.com account was created (Analytics: signups by method). Older accounts: Google when linked, else unknown.
ALTER TABLE "SiteCustomer" ADD COLUMN "signupMethod" TEXT;
UPDATE "SiteCustomer" SET "signupMethod" = 'google' WHERE "googleSub" IS NOT NULL;
