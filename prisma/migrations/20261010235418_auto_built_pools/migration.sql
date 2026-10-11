-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "inventoryItemId" TEXT,
ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "reservedQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Pull" ADD COLUMN     "unreservedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Series" ADD COLUMN     "buildRules" JSONB,
ADD COLUMN     "reserveInventory" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tierRules" JSONB;
