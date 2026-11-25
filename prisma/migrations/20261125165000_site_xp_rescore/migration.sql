-- Rescore cardbit.com (shop 'cardbit-site') XP under the Nov 25 2026 rules, approved by Trevor:
-- 2 XP per 100 Cardbits on paid packs (no flat per pack), 5 XP per check-in, spin XP prizes / 5,
-- Club bonus XP rescaled with its pack. Only the standalone site's rows are touched; Shopify
-- Cardbit rows (other shop values) are left alone. Old values are saved to AppValue first.

BEGIN;
LOCK TABLE "CardbitXpEvent", "CardbitProfile" IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO "AppValue" ("key", "value", "updatedAt")
SELECT 'cardbit-site:xp-rescore-backup-2026-11-25',
       json_build_object(
         'profiles', COALESCE((SELECT json_agg(json_build_object('customerId', p."customerId", 'xp', p.xp)) FROM "CardbitProfile" p WHERE p.shop = 'cardbit-site'), '[]'::json),
         'events',   COALESCE((SELECT json_agg(json_build_object('id', e.id, 'eventKey', e."eventKey", 'kind', e.kind, 'xp', e.xp)) FROM "CardbitXpEvent" e WHERE e.shop = 'cardbit-site'), '[]'::json)
       )::text,
       NOW()
ON CONFLICT ("key") DO NOTHING;

CREATE TEMP TABLE xp_old AS
SELECT id, "eventKey", kind, xp, source FROM "CardbitXpEvent" WHERE shop = 'cardbit-site';

-- Paid and demo pack openings. Old XP = floor(bits / 10) + 25, so bits ~ (xp - 25) * 10 + 5 and new XP = round(bits * 0.02).
UPDATE "CardbitXpEvent" e
SET xp = GREATEST(0, ROUND(((o.xp - 25) * 10 + 5) * 0.02)::int)
FROM xp_old o
WHERE e.id = o.id AND o.kind = 'pack' AND o.xp > 0;

-- Daily check-ins: 50 -> 5.
UPDATE "CardbitXpEvent" e SET xp = 5 FROM xp_old o WHERE e.id = o.id AND o.kind = 'checkin' AND o.xp > 0;

-- Club bonus XP: scale by the same factor as its pack (old bonus = floor(old pack XP * pct)).
UPDATE "CardbitXpEvent" e
SET xp = FLOOR(o.xp::numeric * np.xp / NULLIF(op.xp, 0))::int
FROM xp_old o
JOIN xp_old op ON op."eventKey" = 'pack:site-open:' || o.source
JOIN "CardbitXpEvent" np ON np.id = op.id
WHERE e.id = o.id AND o.kind = 'subscriber_bonus' AND o.xp > 0;

-- Spins and anything else positive: divide by 5 (25/35/50/75/100/150 -> 5/7/10/15/20/30).
UPDATE "CardbitXpEvent" e
SET xp = ROUND(o.xp / 5.0)::int
FROM xp_old o
WHERE e.id = o.id AND o.kind NOT IN ('pack', 'checkin', 'subscriber_bonus', 'reversal') AND o.xp > 0;

-- Reversals take back exactly the rescored original.
UPDATE "CardbitXpEvent" e
SET xp = -orig.xp
FROM xp_old o
JOIN "CardbitXpEvent" orig ON orig.shop = 'cardbit-site' AND 'reverse:' || orig."eventKey" = o."eventKey"
WHERE e.id = o.id AND o.kind = 'reversal' AND o.xp < 0;

-- Profile totals = sum of rescored events, never below zero.
UPDATE "CardbitProfile" p
SET xp = GREATEST(0, COALESCE((SELECT SUM(e.xp) FROM "CardbitXpEvent" e WHERE e.shop = p.shop AND e."customerId" = p."customerId"), 0))
WHERE p.shop = 'cardbit-site';

DROP TABLE xp_old;
COMMIT;
