-- Card art backfill (Nov 26 2026, Trevor: some cards showed "Artwork Unavailable", e.g. Kyogre 117 ME promo).
-- Copies that arrived from Card Broker without an image get their TCGplayer product's image, the same URL
-- cardImage() in app/site/core/card-image.ts uses for new intake. Only empty images are filled; nothing else changes.
UPDATE "SiteCopy"
SET "image" = 'https://product-images.tcgplayer.com/fit-in/1000x1000/' || "tcgplayerId"::text || '.jpg'
WHERE ("image" IS NULL OR btrim("image") = '') AND "tcgplayerId" IS NOT NULL AND "tcgplayerId" > 0;
