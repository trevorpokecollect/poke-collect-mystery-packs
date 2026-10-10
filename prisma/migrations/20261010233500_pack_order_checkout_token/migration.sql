-- AlterTable
ALTER TABLE "PackOrder" ADD COLUMN "checkoutToken" TEXT;

-- CreateIndex
CREATE INDEX "PackOrder_shop_checkoutToken_idx" ON "PackOrder"("shop", "checkoutToken");
