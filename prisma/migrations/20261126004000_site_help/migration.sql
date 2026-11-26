-- Ask Latch AI help chat (Nov 26 2026).
CREATE TABLE "SiteHelpConversation" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "visitorKey" TEXT NOT NULL,
    "ipHash" TEXT,
    "page" TEXT NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "handoff" BOOLEAN NOT NULL DEFAULT false,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteHelpConversation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SiteHelpConversation_createdAt_idx" ON "SiteHelpConversation"("createdAt");
CREATE INDEX "SiteHelpConversation_customerId_idx" ON "SiteHelpConversation"("customerId");
CREATE INDEX "SiteHelpConversation_visitorKey_createdAt_idx" ON "SiteHelpConversation"("visitorKey", "createdAt");
CREATE INDEX "SiteHelpConversation_ipHash_createdAt_idx" ON "SiteHelpConversation"("ipHash", "createdAt");

CREATE TABLE "SiteHelpMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteHelpMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SiteHelpMessage_conversationId_createdAt_idx" ON "SiteHelpMessage"("conversationId", "createdAt");
CREATE INDEX "SiteHelpMessage_createdAt_idx" ON "SiteHelpMessage"("createdAt");
ALTER TABLE "SiteHelpMessage" ADD CONSTRAINT "SiteHelpMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SiteHelpConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
