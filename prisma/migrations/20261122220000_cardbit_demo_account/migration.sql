-- A test collector never shares inventory, settlement or fulfillment jobs with paid orders.
CREATE TABLE "CardbitDemoAccount" (
  "shop" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "state" JSONB NOT NULL,
  PRIMARY KEY ("shop", "customerId")
);
