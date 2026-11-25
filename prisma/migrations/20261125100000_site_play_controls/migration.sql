CREATE TABLE "SitePlayControl" (
    "customerId" TEXT NOT NULL,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "pending" JSONB NOT NULL DEFAULT '[]',
    "coolOffUntil" TIMESTAMP(3),
    "excludedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SitePlayControl_pkey" PRIMARY KEY ("customerId")
);
CREATE TABLE "SitePlayEvent" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SitePlayEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SitePlayEvent_customerId_createdAt_idx" ON "SitePlayEvent"("customerId", "createdAt");
