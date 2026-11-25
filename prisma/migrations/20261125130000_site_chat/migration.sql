CREATE TABLE "SiteChatMessage" (
    "id" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iconId" TEXT,
    "iconColor" TEXT,
    "badge" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    CONSTRAINT "SiteChatMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SiteChatMessage_room_createdAt_idx" ON "SiteChatMessage"("room", "createdAt");
CREATE INDEX "SiteChatMessage_customerId_createdAt_idx" ON "SiteChatMessage"("customerId", "createdAt");

CREATE TABLE "SiteChatMute" (
    "customerId" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "byEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteChatMute_pkey" PRIMARY KEY ("customerId")
);
