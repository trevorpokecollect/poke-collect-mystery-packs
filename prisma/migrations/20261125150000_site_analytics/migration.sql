-- Site analytics: first-party visits and page views (Card Broker Analytics tab).
CREATE TABLE "SiteVisit" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "customerId" TEXT,
    "newVisitor" BOOLEAN NOT NULL DEFAULT true,
    "staff" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "landingPath" TEXT NOT NULL,
    "exitPath" TEXT NOT NULL,
    "pageviews" INTEGER NOT NULL DEFAULT 1,
    "referrerHost" TEXT,
    "source" TEXT NOT NULL,
    "sourceName" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "device" TEXT NOT NULL,
    "browser" TEXT,
    "os" TEXT,
    "country" TEXT,
    "region" TEXT,
    CONSTRAINT "SiteVisit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SiteVisit_startedAt_idx" ON "SiteVisit"("startedAt");
CREATE INDEX "SiteVisit_lastSeenAt_idx" ON "SiteVisit"("lastSeenAt");
CREATE INDEX "SiteVisit_visitorId_idx" ON "SiteVisit"("visitorId");
CREATE INDEX "SiteVisit_customerId_startedAt_idx" ON "SiteVisit"("customerId", "startedAt");

CREATE TABLE "SitePageView" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SitePageView_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SitePageView_createdAt_idx" ON "SitePageView"("createdAt");
CREATE INDEX "SitePageView_visitId_idx" ON "SitePageView"("visitId");
