-- A pack product can be reused by a later series once the earlier one closes.
DROP INDEX "Series_packVariantId_key";

-- CreateIndex
CREATE INDEX "Series_shop_packVariantId_idx" ON "Series"("shop", "packVariantId");
