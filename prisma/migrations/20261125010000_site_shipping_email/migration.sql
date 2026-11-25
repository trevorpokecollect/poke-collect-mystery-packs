-- Standalone site: shipping + transactional email tables (branch cardbit-site)

-- CreateTable
CREATE TABLE "SiteShipment" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "toName" TEXT NOT NULL,
    "toEmail" TEXT,
    "toAddress" JSONB NOT NULL,
    "addressValidated" BOOLEAN NOT NULL DEFAULT false,
    "cardCount" INTEGER NOT NULL,
    "feeKind" TEXT NOT NULL,
    "feeBits" INTEGER NOT NULL DEFAULT 0,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "paymentRef" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "shippoShipmentId" TEXT,
    "shippoRateId" TEXT,
    "shippoTransactionId" TEXT,
    "carrier" TEXT,
    "service" TEXT,
    "postageCents" INTEGER,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "labelUrl" TEXT,
    "trackingStatus" TEXT,
    "trackingDetail" TEXT,
    "processBy" TIMESTAMP(3) NOT NULL,
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteShipmentItem" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "copyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slot" INTEGER,
    "pocket" INTEGER,

    CONSTRAINT "SiteShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteShipmentEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "actor" TEXT NOT NULL,
    "detail" JSONB,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteShipmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteEmail" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteShipment_idempotencyKey_key" ON "SiteShipment"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SiteShipment_shippoTransactionId_key" ON "SiteShipment"("shippoTransactionId");

-- CreateIndex
CREATE INDEX "SiteShipment_customerId_createdAt_idx" ON "SiteShipment"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "SiteShipment_status_processBy_idx" ON "SiteShipment"("status", "processBy");

-- CreateIndex
CREATE INDEX "SiteShipment_carrier_trackingNumber_idx" ON "SiteShipment"("carrier", "trackingNumber");

-- CreateIndex
CREATE INDEX "SiteShipmentItem_copyId_idx" ON "SiteShipmentItem"("copyId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteShipmentItem_shipmentId_copyId_key" ON "SiteShipmentItem"("shipmentId", "copyId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteShipmentEvent_dedupeKey_key" ON "SiteShipmentEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "SiteShipmentEvent_shipmentId_createdAt_idx" ON "SiteShipmentEvent"("shipmentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SiteEmail_dedupeKey_key" ON "SiteEmail"("dedupeKey");

-- CreateIndex
CREATE INDEX "SiteEmail_status_createdAt_idx" ON "SiteEmail"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "SiteShipmentItem" ADD CONSTRAINT "SiteShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "SiteShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteShipmentEvent" ADD CONSTRAINT "SiteShipmentEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "SiteShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

