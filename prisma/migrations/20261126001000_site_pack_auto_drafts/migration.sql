-- Auto-Fill From Drafts (Trevor, Nov 25 2026): hourly auto-restock may also pool listed Draft cards. Off by default.
ALTER TABLE "SitePack" ADD COLUMN "autoDrafts" BOOLEAN NOT NULL DEFAULT false;
