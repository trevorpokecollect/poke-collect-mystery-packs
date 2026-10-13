# Poke-Collect Mystery Packs

A Shopify app that sells digital mystery packs on poke-collect.com. Customers buy a pack, open it
online with an animation, and the physical cards they pull wait in their vault until they ship them
("Ship My Cards") or pick them up in store.

Plan and business notes: [Digital Mystery Packs Plan](https://claude.ai/code/artifact/d02beb28-a388-4c13-b031-cb13fbc803b8)

## How it works

1. **Series.** In the app admin you create a series (e.g. "Series 1"), choose the pack product customers
   buy, and add the cards in its pool. Each card is a real Shopify variant with its own inventory, kept
   off the Online Store channel. Copies per card set the odds.
2. **Launch.** Launching shuffles every physical copy with a cryptographic RNG into a fixed sequence,
   stores a SHA-256 commitment of that order, and sets the pack's inventory to the number of copies,
   so the store can never oversell. The card list is locked from then on.
3. **Payment = draw.** The `orders/paid` webhook claims the next positions in the sequence for each
   pack on the order (per-series row lock, idempotent on webhook retries). The order's fulfillment is
   put on hold and an "open your packs" link is saved to the order metafield
   `mystery_packs.open_url`.
4. **Reveal.** Customers open packs at `https://poke-collect.com/apps/packs` (Shopify app proxy).
   Logged-in customers see their packs; guests use the link from the metafield. The browser only
   learns a card when the pack is opened, and the result was fixed at payment.
5. **Ship.** When every pack on an order is open (or after the series' auto-open window, default 1
   day), the app adds the won cards to the order at 100% off with an order edit, releases its hold,
   and marks the pack line items fulfilled. The card then ships through your normal flow.
6. **Refunds and cancellations** void the unshipped pulls. Voided copies are not resold, so the
   published sequence stays intact; the physical card just stays in stock.
7. **Fairness.** The odds feed (`/apps/packs/api/odds/<handle>`) shows every card, copies left and
   current odds, plus the commitment hash. Once a series closes it also publishes the salt and full
   sequence, so anyone can check `sha256(salt + ":" + sequence.join(","))` against the hash.

## Layout

| Path | What it is |
| --- | --- |
| `app/lib/pool.server.ts` | Database-only logic: launch, draw, reveal, auto-open, void, odds |
| `app/lib/orders.server.ts` | Shopify calls: fulfillment holds, order edit, fulfilling pack lines |
| `app/lib/series.server.ts` | Admin helpers: create series, add cards, launch + set pack inventory |
| `app/routes/webhooks.*` | `orders/paid`, `orders/cancelled`, `refunds/create` |
| `app/routes/proxy.*` | Storefront app proxy: My Packs page, pulls, open, odds |
| `app/routes/app.*` | Embedded admin: series list, new series, series detail |
| `app/routes/jobs.auto-open.tsx` | Cron endpoint: auto-open and retry finalizing orders |
| `public/packs/opener.{js,css}` | My Packs page and opening animation |
| `extensions/mystery-packs-theme` | Theme app block showing a series' card list and odds |

## Development

Requires Node 22 and Postgres.

```shell
cp .env.example .env            # set DATABASE_URL
npm install
npx prisma migrate dev
shopify app dev                 # links the app and opens a tunnel to a dev store
```

Tests run against a real Postgres database, because the draw relies on row locks:

```shell
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/packs_test npm test
```

## Deploying on Railway

1. Create a Railway project from this repo and add the **Postgres** plugin (sets `DATABASE_URL`).
2. Set the variables in `.env.example` on the app service. `SHOPIFY_APP_URL` is the Railway public URL.
3. Railway builds the `Dockerfile`; startup runs `prisma migrate deploy` then the server.
4. Point the app at Railway: set `application_url` and `redirect_urls` in `shopify.app.toml` to the
   Railway URL, then `shopify app deploy` (pushes config, webhooks, app proxy and the theme block).
5. Add a Railway cron service (e.g. every 15 minutes) that runs:
   `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" $SHOPIFY_APP_URL/jobs/auto-open`

## Store setup

- **Pack product:** requires shipping (so checkout collects an address and shipping), tracks
  inventory at one location. The app sets its quantity at launch; when refunding, don't restock it.
- **Card products:** active, but removed from the Online Store sales channel so they can't be bought
  directly. Their inventory is only decremented when a pulled card is added to an order.
- **Theme:** add the "Mystery pack odds" block to the pack product template and enter the series
  handle. Add a "My Packs" link to the account menu or header pointing to `/apps/packs`.
- **Pack product type:** set the pack product's type to `Mystery Pack` (the confirmation email uses it).
- **Thank-you and order status pages:** in Settings > Checkout > Customize, add the "Open your pack" app
  block to the Thank you page and the Order status page. It shows "Preparing your pack..." for the few
  seconds until the card is drawn, then "Open it now", which opens the pack straight into the animation.
- **Order confirmation email:** paste `docs/order-confirmation-email.liquid` above the `{% if order_status_url %}`
  block in Settings > Notifications > Order confirmation. It links to the open link, or to the order status page
  when the email goes out before the link is saved.
