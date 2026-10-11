ALTER TABLE "PackOrder" ADD COLUMN "vault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Pull" ADD COLUMN "shipRequestId" TEXT;
ALTER TABLE "Pull" ADD COLUMN "shipOrderId" TEXT;

CREATE TABLE "ShipRequest" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "draftOrderId" TEXT,
    "invoiceUrl" TEXT,
    "orderId" TEXT,
    "cardCount" INTEGER NOT NULL,
    "shippingFee" DECIMAL(10,2) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShipRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ShipRequest_shop_status_idx" ON "ShipRequest"("shop", "status");
ALTER TABLE "Pull" ADD CONSTRAINT "Pull_shipRequestId_fkey" FOREIGN KEY ("shipRequestId") REFERENCES "ShipRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
