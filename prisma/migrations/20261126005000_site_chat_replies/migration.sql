-- Site chat: replies (snapshot of the quoted message) and the author's level at send time.
ALTER TABLE "SiteChatMessage" ADD COLUMN "level" INTEGER;
ALTER TABLE "SiteChatMessage" ADD COLUMN "replyToId" TEXT;
ALTER TABLE "SiteChatMessage" ADD COLUMN "replyName" TEXT;
ALTER TABLE "SiteChatMessage" ADD COLUMN "replyBody" TEXT;
