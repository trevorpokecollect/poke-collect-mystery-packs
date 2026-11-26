-- Prize pools (Trevor, Nov 26 2026): every Daily Spin and the Spark Shop get the same pool tools as packs
-- (Pool Rules, tiers, staged + published restocks, Auto-Fill From Drafts) plus Fill Rules by value range.
ALTER TABLE "SitePack" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'pack';
ALTER TABLE "SitePack" ADD COLUMN "fillTargets" JSONB;
-- Prize pools have no price (never sold for Cardbits); packs still need a positive price.
ALTER TABLE "SitePack" DROP CONSTRAINT "SitePack_price_check";
ALTER TABLE "SitePack" ADD CONSTRAINT "SitePack_price_check" CHECK (("priceBits" > 0 OR "kind" <> 'pack') AND "priceBits" >= 0 AND "cardsPerPack" BETWEEN 1 AND 20);
ALTER TABLE "SiteCopy" ADD COLUMN "acquiredVia" TEXT;
ALTER TABLE "CardbitSpin" ADD COLUMN "copyId" TEXT;
ALTER TABLE "CardbitSpin" ADD COLUMN "valueBits" INTEGER;
CREATE UNIQUE INDEX "CardbitSpin_copyId_key" ON "CardbitSpin"("copyId");

-- One pool per Daily Spin (ids follow the spin ids) plus the Spark Shop. Max card value = the Official Rules
-- cap for that spin (Sprout $5, Ember $7.50, Frost $10, Gold Rush $25, Dragon $50, Prism $100).
INSERT INTO "SitePack" ("id","title","priceBits","cardsPerPack","active","sortOrder","kind","maxValueBits","updatedAt") VALUES
  ('spin-basic','Sprout Spin',0,1,false,101,'spin',500,CURRENT_TIMESTAMP),
  ('spin-bronze','Ember Spin',0,1,false,102,'spin',750,CURRENT_TIMESTAMP),
  ('spin-silver','Frost Spin',0,1,false,103,'spin',1000,CURRENT_TIMESTAMP),
  ('spin-gold','Gold Rush Spin',0,1,false,104,'spin',2500,CURRENT_TIMESTAMP),
  ('spin-cobalt','Dragon Spin',0,1,false,105,'spin',5000,CURRENT_TIMESTAMP),
  ('spin-holo','Prism Spin',0,1,false,106,'spin',10000,CURRENT_TIMESTAMP),
  ('sparks-shop','Spark Shop',0,1,false,201,'sparks',NULL,CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
