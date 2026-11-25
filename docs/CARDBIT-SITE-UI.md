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

## Not ported yet

Rewards and leaderboard pages, daily giveaway entry window (Whatnot + email entry), Welcome Rewards,
Vault Portfolio chart. Each needs a site API from the lead thread first.
