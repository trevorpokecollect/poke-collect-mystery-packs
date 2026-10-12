-- Multi-card packs: a series can put several cards in each pack; each card is its own pull.
ALTER TABLE "Series" ADD COLUMN "cardsPerPack" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Pull" ADD COLUMN "cardIndex" INTEGER NOT NULL DEFAULT 0;
DROP INDEX "Pull_lineItemId_packIndex_key";
CREATE UNIQUE INDEX "Pull_lineItemId_packIndex_cardIndex_key" ON "Pull"("lineItemId", "packIndex", "cardIndex");
