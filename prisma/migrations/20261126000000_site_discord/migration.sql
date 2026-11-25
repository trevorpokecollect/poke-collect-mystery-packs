-- Discord community (Nov 25 2026): site-rank Linked Roles and the opt-in live pulls feed.
CREATE TABLE "SiteDiscordLink" (
    "customerId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "discordName" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "pushedLevel" INTEGER,
    "pushedAt" TIMESTAMP(3),
    "shareFeedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteDiscordLink_pkey" PRIMARY KEY ("customerId")
);
CREATE UNIQUE INDEX "SiteDiscordLink_discordUserId_key" ON "SiteDiscordLink"("discordUserId");

CREATE TABLE "SiteDiscordPost" (
    "copyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "openingId" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteDiscordPost_pkey" PRIMARY KEY ("copyId")
);
CREATE INDEX "SiteDiscordPost_customerId_idx" ON "SiteDiscordPost"("customerId");
