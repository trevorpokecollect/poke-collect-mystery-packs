-- CreateTable
CREATE TABLE "WishItem" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "alertedPullIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WishItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WishItem_shop_variantId_idx" ON "WishItem"("shop", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "WishItem_shop_customerId_variantId_key" ON "WishItem"("shop", "customerId", "variantId");

