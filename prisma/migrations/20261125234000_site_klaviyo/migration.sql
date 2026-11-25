-- Klaviyo marketing events from the standalone site (cardbit.com). One row per event, deduplicated by key.
CREATE TABLE "SiteKlaviyoEvent" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "properties" JSONB NOT NULL,
    "value" DOUBLE PRECISION,
    "time" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteKlaviyoEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SiteKlaviyoEvent_dedupeKey_key" ON "SiteKlaviyoEvent"("dedupeKey");
CREATE INDEX "SiteKlaviyoEvent_status_nextAt_idx" ON "SiteKlaviyoEvent"("status", "nextAt");
