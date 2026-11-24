-- CreateTable
CREATE TABLE "CardbitAgeConfirmation" (
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardbitAgeConfirmation_pkey" PRIMARY KEY ("shop","customerId")
);
