-- Site chat auto-moderation: flagged queue (instant filter, AI check, player reports).
CREATE TABLE "SiteChatFlag" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "category" TEXT NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 1,
    "strike" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "room" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "messageId" TEXT,
    "body" TEXT NOT NULL,
    "reason" TEXT,
    "reporterId" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    CONSTRAINT "SiteChatFlag_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SiteChatFlag_messageId_reporterId_key" ON "SiteChatFlag"("messageId", "reporterId");
CREATE INDEX "SiteChatFlag_status_createdAt_idx" ON "SiteChatFlag"("status", "createdAt");
CREATE INDEX "SiteChatFlag_customerId_createdAt_idx" ON "SiteChatFlag"("customerId", "createdAt");
