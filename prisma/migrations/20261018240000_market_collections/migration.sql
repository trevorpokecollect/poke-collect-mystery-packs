-- AlterTable
ALTER TABLE "Trader" ADD COLUMN "showCollection" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "showcase" TEXT[] DEFAULT ARRAY[]::TEXT[];
