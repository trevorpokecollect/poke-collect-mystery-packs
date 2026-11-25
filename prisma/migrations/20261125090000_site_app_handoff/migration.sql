-- iPhone app sign-in hand-off codes (standalone site). Additive.
CREATE TABLE "SiteAppHandoff" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    CONSTRAINT "SiteAppHandoff_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SiteAppHandoff_customerId_idx" ON "SiteAppHandoff"("customerId");
