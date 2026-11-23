CREATE TABLE "CardbitLaunchBatch" (
  "seriesId" TEXT NOT NULL REFERENCES "Series"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "index" INTEGER NOT NULL, "revision" TEXT NOT NULL, "moves" JSONB NOT NULL,
  "cancelling" BOOLEAN NOT NULL DEFAULT false, "releasedAt" TIMESTAMP(3),
  "generation" INTEGER NOT NULL DEFAULT 0, "attemptedAt" TIMESTAMP(3), "confirmedAt" TIMESTAMP(3),
  PRIMARY KEY ("seriesId", "index")
);
