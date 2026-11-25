# Cardbit standalone site (branch `cardbit-site`)

Cardbit's own website with Coinflow as the processor, built **alongside** the Shopify setup.
Trevor's rule (Nov 24 2026): nothing here may change how Cardbit on Shopify, its theme, or
Card Broker for Cardbit-on-Shopify work today. Shopify must stay usable with another processor.

## Separation

| Piece | Shopify setup (unchanged) | Standalone site |
| --- | --- | --- |
| Packs code | branch `cardbit` | branch `cardbit-site` (never merged into `cardbit` without Trevor's OK) |
| Railway | `cardbit-mystery-packs / production / app` | `cardbit-mystery-packs / site / app-site` (own environment) |
| Database | production Postgres | the `site` environment's own Postgres |
| Card Broker | Shopify listings + shelf intake to production | extra destination, OFF by default (`CARDBIT_SITE_INTAKE=on`), posts to the site origin only |
| Domain | cardbit.com (Shopify) | Railway test URL until Trevor chooses which setup goes live |
| Stock | real stock | test stock only until Trevor approves moving real stock |

Pushes to `cardbit-site` do not deploy production: CI deploys only `cardbit`, and
`scripts/start-cardbit.sh` refuses any branch but `cardbit` on the production service.
The site environment gets its own guarded start script, like `stripe-test`.

## Stock model (site database is the source of truth)

One row per physical copy. Shopify IDs are not used.

```
SiteCopy
  id            cuid
  printingKey   lookKey(game, set, number) + finish + language   -- same folding as shelf.server.ts
  tcgplayerId   Int?            -- from Card Broker's catalog match
  title, setName, number, name, finish, language, condition, image
  slot, pocket  Int?            -- storage address (20/slot, 20 slots/box, 100/shelf)
  status        FOR_SALE | POOLED | VAULTED | SHIP_LOCKED | SHIPPED | SOLD_BACK_PENDING | REMOVED
  retailBits    Int?            -- 100% Poke-Collect retail in Cardbits, refreshed daily
  ownerId       String?         -- site customer when VAULTED / SHIP_LOCKED
  poolSlotId    String? unique  -- pack slot when POOLED
  orderId       String?
  receiptKey    String          -- Card Broker eventKey + unit, unique (idempotent intake)
  updatedAt
```

Rules:
- A status change is one conditional UPDATE (`WHERE id = ? AND status = ?`). A copy can only be sold,
  pooled, vaulted or shipped once. The last copy has exactly one winner.
- Every change writes a `SiteCopyEvent` row (from, to, actor, reason, idempotency key) for audit.
- Buyback returns a VAULTED copy to FOR_SALE at full retail after the Cardbits credit commits.
- Pool building selects FOR_SALE copies and moves them to POOLED inside the launch transaction.

## Card Broker → site intake

`POST /internal/site-intake` on the site origin, same auth shape as `/internal/cardbit-shelf-intake`
(Bearer secret, `x-cardbit-shop`), but its own secret `CARDBIT_SITE_INTAKE_SECRET`.

```
{ eventKey, quantity, title, game, setName, number, name, finish, language, condition,
  tcgplayerId?, image? }
```

No Shopify variant or location. Replays with the same eventKey return the original result.
Card Broker change: a second flush (`flushSiteIntake`) next to `flushShelfIntake`, reading from
its own queue, only when `CARDBIT_SITE_INTAKE=on`. The existing Shopify flush is untouched.

## Pricing

Unchanged sources: retail and buyback come from Poke-Collect's per-card buylist lookup
(`buylist.server.ts`), which does not depend on Cardbit's Shopify store.

## Open items

- Coinflow sandbox keys (Trevor).
- Shippo account (Trevor) — Pirate Ship has no public API.
- Transactional email sender for hello@cardbit.com (Postmark or Resend).

## Published policy the site must enforce

- Vault shipping: $6 or 600 Cardbits per shipment, free at 30 or more cards or 10,000 Cardbits of card value (copy retail, else Card Broker retail, else buyback). US addresses only.
- Excluded states: AL, HI, ID, MN, NV, NY, UT, WA. Block top-ups, pack purchases and shipping
  when either the billing address or the request IP geolocates to one of them. Check on the server
  at each of those three actions, not only at sign-up.
- Home page: no Just Pulled section or live pull ticker.

## Approved design to port (cardbit-theme)

- Hero banners: main a9fb38f (`assets/cardbit-hero-scenes.js`, `cardbit-latch-rig-cut.webp`,
  hero code in `cardbit-storefront.js`, "Full-width hero scenes" CSS in `cardbit-flair.css`).
- Policies page: main (from `cardbit-policies-v2`).
- How It Works: PR #1, branch `cardbit-how-it-works-live`.

## Shipping + transactional email (branch `cardbit-site-shipping`)

Code: `app/site/region.server.ts`, `app/site/shipping/*`, `app/site/email/*`,
route `app/routes/site.webhooks.shippo.tsx` (404 unless `CARDBIT_SITE=on`).
Tables (fenced block at the end of `schema.prisma`): `SiteShipment`, `SiteShipmentItem`,
`SiteShipmentEvent`, `SiteEmail`.

Flow:
1. `createShipment` — region check (billing + delivery + IP), Shippo address validation (the
   normalized state is re-checked), fee per `policy.ts` ($6 / 600 Cardbits, free at 30+ cards or 10,000 Cardbits of value),
   then one transaction: shipment row, `CopyStore.lockForShipment` (whole selection or nothing),
   `FeePayer.debitBits`. Same idempotency key = same shipment. Email "shipment_created".
2. `cancelShipment` — only before a label; releases copies, refunds the Cardbits once.
3. `buyLabel` (staff) — conditional PAID → LABEL_PENDING claim, so a double click buys one label.
   Prefers USPS Ground Advantage, then Priority, then UPS (override `CARDBIT_SHIP_SERVICES`).
4. Tracking — Shippo `track_updated` webhook at `/site/webhooks/shippo?token=…`. The handler re-reads
   tracking from Shippo, dedupes, only moves forward. First TRANSIT (or staff `markShipped`) moves
   copies SHIP_LOCKED → SHIPPED and emails "shipped"; DELIVERED emails "delivered".
5. Fix Card (staff, before a label): `fixShipmentCard(deps, id, { action: "swap" | "remove", copyId, revision })`.
   Swap takes the lowest filed FOR_SALE copy of the same printing and condition, makes it the customer's
   SHIP_LOCKED copy, and returns the old copy to stock unfiled (staff re-inspect and re-file it), so the
   customer never owns two copies. Remove returns the card to the customer's vault; the last card can't be
   removed (cancel instead); the fee is unchanged. Both claim the shipment row first, so they serialize with
   Buy Label and with another desk. Pick lines carry the card photo (`SiteShipmentItem.image`).
6. Staff desk: `/staff/shipping` (queue, pick list with photos and slot/pocket, Fix Card, Compare Rates,
   Buy Label, Print Label, Mark Dropped Off, Cancel) and `/staff/shipping/slip/:id`. 404 unless
   `CARDBIT_SITE=on` and the signed-in customer's email is in `SITE_STAFF_EMAILS`; posts must be same-origin.
7. `shippingQueue` lists paid shipments with `overdue` past the 48-hour promise. `packingSlipHtml`
   prints the card list sorted by slot/pocket.

Contracts the lead implements (`app/site/shipping/types.ts`): `CopyStore` on SiteCopy
(`sql-copy-store.ts` is a working reference using conditional UPDATEs) and `FeePayer` on the
wallet ledger (`verifyUsd` optional until Trevor decides on card payments). Register both once at
startup with `registerSiteShipping()` from `wire.server.ts`.

Email: `sendEmail(deps, kind, to, data, dedupeKey)` — kinds `signin_code`, `topup_receipt`,
`pack_receipt`, `pack_opened`, `buyback_confirmation`, `shipment_created|shipped|delivered`.
Call after your transaction commits; the dedupe key (e.g. pull id, order id) guarantees one send.
Sign-in codes are never stored. `sendPendingEmails` retries failures (run from the site cron).
Email links assume routes `/packs`, `/openings`, `/vault`, `/shipments/:id` on `CARDBIT_SITE_URL`.

Env (site / app-site): `SHIPPO_API_TOKEN` (test key set), `SHIPPO_WEBHOOK_TOKEN` (set),
`CARDBIT_SHIP_FROM_*` (ship-from address — needed before label tests),
`CARDBIT_SITE_RESEND_API_KEY` (pending Trevor), `CARDBIT_SITE_MAIL_FROM` (set),
`CARDBIT_SITE_IPINFO_TOKEN` (optional; without it IP isn't checked, addresses still are),
`CARDBIT_SITE_URL`.

### Backup label provider: EasyPost

`app/site/shipping/easypost.server.ts` implements the same `ShippingProvider` as Shippo. Rates come back
with Shippo-style service tokens, so `pickRate` and `CARDBIT_SHIP_SERVICES` behave the same.
- Switch: `CARDBIT_LABEL_PROVIDER=easypost` (anything else or unset = Shippo). No silent fallback: picking
  EasyPost without `EASYPOST_API_KEY` turns Buy Label off rather than quietly using Shippo.
- Keys: `EASYPOST_API_KEY` (`EZTK…` test key; `EZAK…` = live postage, needs Trevor's OK).
- Tracking: `/site/webhooks/easypost?token=<EASYPOST_WEBHOOK_TOKEN>` (EasyPost `tracker.updated`), optional
  `EASYPOST_WEBHOOK_SECRET` checks `X-Hmac-Signature`. Each webhook re-reads tracking from the provider that
  sent it, so labels bought before a switch keep tracking. The desk shows which provider and mode is active,
  and System Check runs against it.
- DB columns keep the `shippo*` names; with EasyPost, `shippoShipmentId`/`shippoTransactionId` hold the
  EasyPost shipment id and `shippoRateId` the EasyPost rate id. `label_purchased` events record the provider.

## Cardbits top-up (Coinflow card checkout)

- `/checkout/cardbits?amount=1000|5000|10000|50000&return_to=` (sign-in required) asks for billing state + ZIP, runs the state block (billing + IP), records a PENDING `SiteTopup`, then redirects to Coinflow's hosted link (`POST {api}/checkout/link`, `webhookInfo.topupId`, `standaloneLinkConfig.callbackUrl` = `/checkout/cardbits/return`).
- `/webhooks/coinflow` verifies `COINFLOW_WEBHOOK_SECRET` (Authorization header or `Coinflow-Signature` HMAC, 5 min tolerance), logs every event in `SiteWebhookEvent`, and:
  - `Settled`: amount must equal the package; credits `TOPUP` + separate `BONUS` once (`topup:{id}:base|bonus`), sends `topup_receipt`.
  - `Refund`: takes back the refunded share as far as the balance allows; the spent part goes to `SiteTopup.owedBits`.
  - `Card Payment Chargeback Opened`: same claw-back, freezes the account. `Won` returns the Cardbits (account stays frozen for staff review); `Lost` just records it.
- Coinflow's chargeback-protection script (nSure) is in the head of every site page; sandbox partner id `COINFTEST`, production partner id via `COINFLOW_NSURE_PARTNER_ID`.
- Optional env: `COINFLOW_PRODUCT_TYPE` (default `topUp`), `COINFLOW_SETTLEMENT_TYPE`, `COINFLOW_AUTH_BLOCKCHAIN`.
- Shipping fees: `ledgerFeePayer` (app/site/core/fees.server.ts) debits `SHIPPING` / refunds `REFUND`; USD shipping stays off. Wired in app/site/boot.server.ts.

## Backup processor: Stripe (test mode)

- `SITE_PAYMENT_PROVIDER=stripe` + `SITE_STRIPE_SECRET_KEY` (sk_test_/rk_test_) + `SITE_STRIPE_WEBHOOK_SECRET` (whsec_) switches `/checkout/cardbits` to Stripe hosted Checkout. Default and fallback = Coinflow.
- Live keys are refused unless `SITE_STRIPE_LIVE_APPROVED=yes` (Trevor only, after Stripe's written business-model approval).
- Webhook `/site/webhooks/stripe` (separate from production `/webhooks/stripe`): checkout.session.completed (session re-read from Stripe), charge.refunded, charge.dispute.created/closed. Same crediting, refund and chargeback rules as Coinflow (shared handler); payment ids are stored as `stripe:<payment_intent>`.
- Names differ from production's `STRIPE_*` on purpose; the app-site start script refuses `STRIPE_SECRET_KEY`.
