-- One printing = one TCGplayer product (Nov 25 2026, Trevor: regular Snorlax 051 copies showed the Pokemon Center
-- Exclusive's $265 price). printingKey becomes sha256('["<old key>",<tcgplayerId>]'), the same value as
-- printingKey() in app/site/core/stock.server.ts, for every copy that has a TCGplayer product id.
-- Prices: a printing+condition whose copies (any status) all share one product keeps its price under the new key.
-- Printings shared by two or more products get no carried-over price; Card Broker's next price sync sets each one.
-- Want-list entries move to the new single key. Old price rows are left in place (unused).

CREATE TEMP TABLE "_rekey" AS
SELECT DISTINCT
  c."printingKey" AS old_key,
  c."tcgplayerId" AS tcg,
  encode(sha256(convert_to('["' || c."printingKey" || '",' || c."tcgplayerId"::text || ']', 'UTF8')), 'hex') AS new_key
FROM "SiteCopy" c
WHERE c."tcgplayerId" IS NOT NULL;

CREATE TEMP TABLE "_shared" AS
SELECT old_key FROM "_rekey" GROUP BY old_key HAVING count(DISTINCT tcg) > 1;

-- Carry prices over only for printings that belong to one product.
INSERT INTO "SitePrice" ("printingKey", "retailBits", "buybackBits", "source", "updatedAt")
SELECT DISTINCT ON (r.new_key || '|' || p.cond)
  r.new_key || '|' || p.cond, sp."retailBits", sp."buybackBits", sp."source", now()
FROM "_rekey" r
JOIN (
  SELECT DISTINCT "printingKey", lower(regexp_replace(btrim(condition), '\s+', ' ', 'g')) AS cond FROM "SiteCopy"
) p ON p."printingKey" = r.old_key
JOIN "SitePrice" sp ON sp."printingKey" = r.old_key || '|' || p.cond
WHERE r.old_key NOT IN (SELECT old_key FROM "_shared")
ON CONFLICT ("printingKey") DO NOTHING;

-- Want-list entries: s_ + first 20 hex of sha256('<printingKey>|<condition>') (singleKey in app/site/store/store.server.ts).
UPDATE "SiteWant" w
SET "cardKey" = m.new_single
FROM (
  SELECT DISTINCT
    's_' || left(encode(sha256(convert_to(c."printingKey" || '|' || c.condition, 'UTF8')), 'hex'), 20) AS old_single,
    's_' || left(encode(sha256(convert_to(r.new_key || '|' || c.condition, 'UTF8')), 'hex'), 20) AS new_single
  FROM "SiteCopy" c
  JOIN "_rekey" r ON r.old_key = c."printingKey" AND r.tcg = c."tcgplayerId"
  WHERE r.old_key NOT IN (SELECT old_key FROM "_shared")
) m
WHERE w."cardKey" = m.old_single
  AND NOT EXISTS (SELECT 1 FROM "SiteWant" x WHERE x."customerId" = w."customerId" AND x."cardKey" = m.new_single);

UPDATE "SiteCopy" c
SET "printingKey" = r.new_key
FROM "_rekey" r
WHERE r.old_key = c."printingKey" AND r.tcg = c."tcgplayerId";

DROP TABLE "_shared";
DROP TABLE "_rekey";
