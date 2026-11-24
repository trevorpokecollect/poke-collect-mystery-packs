-- One Daily Spin per unlocked tier per Cardbit day.
DROP INDEX IF EXISTS "CardbitSpin_shop_customerId_day_key";
CREATE UNIQUE INDEX "CardbitSpin_shop_customerId_day_tier_key" ON "CardbitSpin"("shop", "customerId", "day", "tier");
