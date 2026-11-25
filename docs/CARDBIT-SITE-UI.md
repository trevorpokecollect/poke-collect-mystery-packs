# Cardbit site: customer pages (branch `cardbit-site-ui`, off `cardbit-site`)

The approved Cardbit Dark theme design, served by the Packs app on the site environment.
Everything here is inert unless `CARDBIT_SITE=on` (set only on `cardbit-mystery-packs / site / app-site`).

## How it is built

- `scripts/site/port-theme.mjs <cardbit-theme checkout>` copies the theme's `cardbit-*` assets to
  `public/site/assets/` (minus Shopify-only scripts), applies the `/* SITE */` patches, renders
  How It Works and Policies from Liquid into `app/site/partials/`, and writes `app/site/assets-manifest.json`.
  Source: theme `main` 711b2bf (hero scenes, policies, no Just Pulled) merged with `cardbit-how-it-works-live` ff3a0cf.
  Re-run after any approved theme change; do not hand-edit `public/site/assets`.
- `app/site/shell.server.ts` is the page shell (mirrors `layout/cardbit-dark.liquid`).
- `public/site/js/cardbit-site-store.js` is the data connection (replaces the theme's Shopify/IndexedDB stores).

## Routes

| Path | Handler |
| --- | --- |
| `/` | `entry.server.tsx` returns the shell (Shopify install page otherwise) |
| `/packs/*`, `/chase`, `/shop/*`, `/ship-together/*`, `/account/*`, `/orders`, `/shipments/*`, `/vault/*`, `/binder/*`, `/openings/*`, `/cardbits`, `/help`, `/demo/*`, `/latch/*` | `routes/$.tsx` (shell; client renders the page) |
| `/how-it-works` | redirect to `/help` |
| `/policies` | `routes/policies.tsx`, server-rendered |
| `/official-rules` | `routes/official-rules.tsx`, server-rendered from `app/site/partials/official-rules.html` (rules text owned by the sweepstakes rules thread; draft banner and counsel notes stripped) |

Note: `public/packs/` exists, so a bare `/packs` gets a static-directory 301 to `/packs/`; the page still renders.

## Data contract (lead thread owns the API)

Same-origin session cookie, JSON. Errors are non-2xx `{error, code}`; 401 or `code: 'sign_in'` means signed out.

- `GET /api/store/state` → `{account:{id,name,bits}|null, packs, singles, binder, openings, wants, shipments, history, orders?, topupPromotions?}`
  (shape of `view()` in the theme's `assets/cardbit-store-adapter.js`; packs keyed cobalt/prism/gold/ember/amethyst;
  cards carry `retailBits`/`priceBits` and `buybackBits`).
- `POST /api/store/action` `{action, requestId, id, amount, openLater, copyIds, destination}` → `{...result, state}`.
  Actions: open, buy, buyback (amount = quoted offer), ship, ship-group, reveal, want-add, want-remove.
- `POST /api/store/logout` → `{state}`
- `GET /api/pool?product=…` (pool odds)
- Sign in: `/sign-in?return_to=<path>`. Top-ups: `/checkout/cardbits?amount=<base Cardbits>&return_to=<path>`
  (amount is 1000/5000/10000/50000; bonus 500 on 10000, 5000 on 50000).

## Ship Together (site)

`scripts/site/patches/ship-together.js` replaces the theme's sample destinations with a US delivery
address form (excluded states shown but disabled), a 600 Cardbits fee that drops to free for more than
30 cards, a balance check with a Buy Cardbits link, and a review step. It sends
`{action:'ship-group', copyIds, address:{name,street1,street2,city,state,zip,phone}, method:'CARDBITS'}`.
Server errors `address_invalid` (fields[]), `region_blocked`, `unavailable`, `insufficient_bits`,
`account_frozen` show in the review dialog. A single-card Ship button opens Ship Together with that card selected.

## Site fixes over the theme (Nov 25)

- Home shows the Live Pulls card feed (no text ticker). Real pulls from `GET /api/recent` show as "Just Pulled"
  with time ago; until there are any, the feed cycles pool cards under "In the Packs" (patches/live-pulls.js).
- Footer Policies is a plain link like the others.
- Pack page holo is sized and rotated to the pack image (flair `fitHolo`), so it follows the wrapper shape.
- Hero: the conveyor uses a whole number of evenly spaced packs (no overlap at the wrap); on desktop the
  giveaway and levels scenes stay inside the content column (mobile unchanged); Ship Home is redrawn
  (patches/ship-home.js replaces the block in patches/ship-home.from.txt).
- `scripts/site/overrides/` replaces theme files after the copy (cardbit-latch-cheer.webp: background
  behind Latch's feet removed).

## Not ported yet

Rewards and leaderboard pages, daily giveaway entry window (Whatnot + email entry), Welcome Rewards,
Vault Portfolio chart. Each needs a site API from the lead thread first.

### Audit fixes (Nov 25)
- Tiers appear only in pools: the store sends `tier: null` for Shop Singles and vault cards (openings keep theirs).
- How It Works reveals: a scroll/timer sweep shows any tile at or above the viewport bottom, so tiles never stay at opacity 0.
- Official Rules, Rewards and Leaderboard use the full site header (nav, wallet, account) and footer (`siteHeader`/`siteFooter` in `app/site/pages.server.ts`). Rules contact is Support@cardbit.com.
- Chase and Shop Singles load the first 15 images eagerly. Singles without a back photo no longer show "Back Unverified".
- Signed-out wallet reads 0. `/open/*` and `/welcome` return 200.

## iPhone app sign-in (branch `cardbit-site-app-auth`)

The app opens `/app-handoff?challenge=<base64url sha256(verifier)>` in ASWebAuthenticationSession.
Signed out, it goes through the normal `/sign-in` (any method, 18+ included) and returns there. Signed in,
it redirects to `cardbit://signed-in?code=<one-time code>` (2 minutes, single use, bound to the challenge).
The app then calls `POST /api/app/session {code, verifier}` → `{token, expiresAt, state}` plus the `cb_site`
cookie; the token is an ordinary `SiteSession` (90 days). Table `SiteAppHandoff`, migration
`20261125090000_site_app_handoff`. No change to existing sign-in code. App repo: private `trevorpokecollect/cardbit-ios`.

### Welcome Rewards and Daily Giveaway (Nov 25)
- `/api/welcome` (app/site/promos/promos.server.ts): email news 200 Cardbits credited at signup (BONUS, `welcome:email:<id>`); text alerts 300 credited only when the number confirms (`confirmSms`, via `POST /internal/site-promos {action:"sms-confirmed"}` from the texting provider bridge). One reward per channel per account; a confirmed number stays on its account. Consent lives in `SiteMarketing`. Off unless `CARDBIT_SITE_WELCOME=on`.
- `/welcome` page and the home band come from `scripts/site/overrides/cardbit-welcome.js` (replaces the theme's on-device preview).
- `/api/giveaway`: the Shopify giveaway engine with shop key `cardbit-site` (the site runs its own daily drawing). Requires Cardbit email news on, one Whatnot visit, and an unfrozen account. 1 entry per 100 paid Cardbits on Coinflow top-ups (voided on refund or chargeback). Elapsed rounds settle lazily on GET and pay the winner's site wallet (REWARD, `giveaway:<day>`). Closed until staff send `POST /internal/site-promos {action:"giveaway-settings", enabled:true, rulesUrl, freeInstructions}`.
- Not on the site yet: referral entries (the method card is removed) and a winner email.

## Pack reveal rewards, share banners, Discord (Nov 25)
- Reveal: `storeAction` open/reveal return `rewards {xp, sparks}`; state carries `openings[].rewards` and `account.level`/`account.sparks`. The reveal spread shows a Pack Rewards panel (`window.CardbitRevealRewards` in public/site/js/cardbit-site-store.js): XP count-up and level bar (Level Up badge) the first time, a static "Earned From This Pack" on replay. Nothing is awarded on replay.
- Staff demo packs earn XP/Sparks at the pack's list price when revealed (so the full reveal can be tested); Wipe Demo reverses them (`reverseOpeningRewards`).
- Header Sparks pill beside the wallet (storefront `sparksPill()` patch, standalone pages via `siteHeader()` + walletScript). It keeps the old balance until the face-down card is revealed.
- Japanese copies the set lists can't place get the modern Japanese back on the site (card-media patch).
- Link previews: `shareMeta()` in shell.server.ts; per-page text and per-pack banners in app/site/share.server.ts; 1200x630 PNGs in public/site/share/ made by `node scripts/site/share-banners.mjs` (needs the global Playwright: `NODE_PATH=$(npm root -g)`).
- Footer "Join Our Discord" (https://discord.gg/F9Z6jbgj4Y) on storefront and standalone pages.
- port-theme.mjs now keeps site-only subfolders of public/site/assets (email/) instead of wiping them.
