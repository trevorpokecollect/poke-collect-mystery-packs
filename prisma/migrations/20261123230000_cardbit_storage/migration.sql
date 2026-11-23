-- CreateTable
CREATE TABLE "CardbitShelfReceipt" (
    "shop" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardbitShelfReceipt_pkey" PRIMARY KEY ("shop","eventKey")
);

-- CreateTable
CREATE TABLE "CardbitShelfCopy" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "unit" INTEGER NOT NULL,
    "variantId" TEXT NOT NULL,
    "lookKey" TEXT NOT NULL,
    "faceKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "image" TEXT,
    "locationId" TEXT,
    "slot" INTEGER,
    "pocket" INTEGER,
    "filedAt" TIMESTAMP(3),
    "poolSlotId" TEXT,
    "parcelId" TEXT,
    "shippedAt" TIMESTAMP(3),
    "lastSlot" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardbitShelfCopy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardbitShelfBinding" (
    "poolSlotId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "copyId" TEXT NOT NULL,
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardbitShelfBinding_pkey" PRIMARY KEY ("poolSlotId")
);

-- CreateTable
CREATE TABLE "CardbitShelfParcel" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'READY',
    "manifest" JSONB NOT NULL,
    "revision" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "tracking" TEXT,
    "carrier" TEXT,
    "labelResultId" TEXT,
    "labelState" TEXT,
    "fulfillmentId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardbitShelfParcel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardbitShelfCopy_poolSlotId_key" ON "CardbitShelfCopy"("poolSlotId");

-- CreateIndex
CREATE INDEX "CardbitShelfCopy_shop_variantId_slot_idx" ON "CardbitShelfCopy"("shop", "variantId", "slot");

-- CreateIndex
CREATE INDEX "CardbitShelfCopy_shop_parcelId_idx" ON "CardbitShelfCopy"("shop", "parcelId");

-- CreateIndex
CREATE UNIQUE INDEX "CardbitShelfCopy_shop_eventKey_unit_key" ON "CardbitShelfCopy"("shop", "eventKey", "unit");

-- CreateIndex
CREATE UNIQUE INDEX "CardbitShelfCopy_shop_slot_pocket_key" ON "CardbitShelfCopy"("shop", "slot", "pocket");

-- CreateIndex
CREATE UNIQUE INDEX "CardbitShelfCopy_shop_slot_lookKey_key" ON "CardbitShelfCopy"("shop", "slot", "lookKey");

-- CreateIndex
CREATE UNIQUE INDEX "CardbitShelfCopy_shop_slot_faceKey_key" ON "CardbitShelfCopy"("shop", "slot", "faceKey");

-- CreateIndex
CREATE INDEX "CardbitShelfBinding_shop_copyId_idx" ON "CardbitShelfBinding"("shop", "copyId");

-- CreateIndex
CREATE INDEX "CardbitShelfParcel_shop_orderId_idx" ON "CardbitShelfParcel"("shop", "orderId");

ALTER TABLE "CardbitShelfCopy" ADD CONSTRAINT "cardbit_shelf_address" CHECK (
 (slot IS NULL AND pocket IS NULL AND "shippedAt" IS NOT NULL AND "lastSlot" > 0)
 OR (slot IS NOT NULL AND slot > 0 AND pocket IS NOT NULL AND pocket BETWEEN 1 AND 20 AND "shippedAt" IS NULL)
);
ALTER TABLE "CardbitShelfCopy" ADD CONSTRAINT "cardbit_shelf_receipt_fk" FOREIGN KEY (shop,"eventKey") REFERENCES "CardbitShelfReceipt"(shop,"eventKey");
ALTER TABLE "CardbitShelfBinding" ADD CONSTRAINT "cardbit_shelf_binding_copy_fk" FOREIGN KEY ("copyId") REFERENCES "CardbitShelfCopy"(id);
