# Cardbit Mystery Packs

Cardbit uses an independent Shopify install and Railway service. The physical-card allocator and vault code originate in the Mystery Packs application. Store-specific behavior checks the authenticated Shopify shop against the explicitly enabled Cardbit configuration.

## Release ownership

| Setting | Cardbit |
| --- | --- |
| GitHub repository | trevorpokecollect/poke-collect-mystery-packs |
| Release branch | `cardbit` |
| Railway project / environment / service | `cardbit-mystery-packs / production / app` |
| Store | `hhuuev-81.myshopify.com` (cardbit.com) |
| Shopify app config | `shopify.app.cardbit.toml` |
| Startup | `sh scripts/start-cardbit.sh` verifies the branch, Railway project, service and environment before starting migrations. |

Keep all Cardbit commits on `cardbit`. A merge in either direction between this branch and `main` requires Trevor's approval for that specific merge. Before any deployment, tell Trevor the branch and exact Railway project, environment and service. Use the branch-connected service for Cardbit releases. Leave Poke-Collect's service, credentials and inventory alone. The November 22 inspection showed its app had a connected repository, no automatic branch selected and an active CLI deployment.

The draft theme renders the branded app-proxy page with the approved wrappers and Latch player. The sample walkthrough uses local fixture records. For purchased packs, the server verifies the Shopify session and original order owner and supplies the assigned cards. A replay uses the saved pack. Cardbit packs open when requested. Storage expiry awaits a business policy. Shipping uses the customer's selected copies, address and confirmed Shopify rate. The Shopify draft owns the reservation during shipping checkout.

## Local checks

Use Node 22.12+ and PostgreSQL 16. Run `npm ci`, `npx prisma generate`, `npm run lint`, `npm run typecheck`, and `npm run build`. Point `DATABASE_URL` and `TEST_DATABASE_URL` at a disposable test database before `npm test`. Integration tests migrate and clear their test data. To opt in to Cardbit behavior locally, set `CARDBIT_STOREFRONT_SHOP=hhuuev-81.myshopify.com`. The Railway start command supplies this setting for the Cardbit release.

## Cardbit Wallet and Owner Pool Launch · November 23, 2026

The Cardbit wallet sells four USD packages. At 100 Cardbits per dollar, $10 delivers 1,000, $50 delivers 5,000, $100 delivers 10,000 plus 500 promotional Cardbits, and $500 delivers 50,000 plus 5,000 promotional Cardbits. The bonus applies separately to each unit purchased. Qualifying spend counts only the externally paid base of an eligible top-up. Buybacks, staff adjustments and promotional credits earn zero qualifying spend.

**Shopify setup.** The dedicated top-up product is a draft. After the merchant's payment provider approves this model, use the exact external Shopify transaction gateway identifier in `CARDBIT_APPROVED_GATEWAYS` on the Cardbit Packs web service and make the top-up product available to the intended Shopify sales channel. Exclude top-ups from product/order discounts. The payment handler verifies captured USD funds, customer, checkout lines and original price. Unverified payments create a zero-credit review entry. A refund or cancellation freezes the funded wallet and excludes the reviewed order from qualifying spend pending reconciliation. Never ship or refund a top-up as a physical card. Keep giveaway credits in the future giveaway integration.

**Owner quick answers.** Create the draft in Card Broker, inspect its printings and quantities, choose **Review Pool Launch**, then **Reserve Cards and Launch**. The previous edition's series must have closed and the pack SKU must have zero Shopify checkout stock with inventory tracked and overselling disabled. The owner action reserves physical singles at their recorded locations and uses the existing native shuffle and SHA-256 commitment. Cardbits and direct Shopify checkout use separate series to avoid two checkouts promising the same pack. A saved wallet purchase always reopens its original award. A customer may accept a current Cardbit offer only for an eligible copy they still hold.

**Interrupted reservations.** The owner can reopen the same draft to resume a reservation or discard it to release its reserved copies. Shopify gets a stable per-batch key and the original quantities on retry. An unresolved call approaching the provider's idempotency window pauses for manual inventory reconciliation. Use the existing native inventory audit for the series before resolving an expired uncertain operation. No real charge or physical launch is required to exercise the included tests on a disposable database.

**Daily observations.** The production `cardbit-prices` service uses the official Node 22 Alpine image, calls the authenticated pricing route once, and exits. Railway runs it at `0 8 * * *` UTC, using the web service's job credential by reference. The deployable equivalent lives in `scheduler/`.

## Cardbits testing

The ledger and buybacks are opt-in. Use a private test service/database with the exact Shopify test configuration approved by the merchant. Set `CARDBIT_COMMERCE_MODE=staging`, `CARDBIT_QA_CUSTOMERS` (comma-separated Shopify customer GIDs), `CARDBIT_TEST_GATEWAY` (exact gateway reported on the Shopify test sale), `CARDBIT_TEST_TOPUPS` (JSON mapping variant GIDs to integer Cardbits) and `CARDBIT_TEST_SERIES` (JSON mapping staff-test series handles to integer prices). The test exchange convention is 100 Cardbits per USD. Leave staging commerce disabled on the production app. Top-ups require a verified fully paid test checkout and successful test transactions. Funding review holds the balance on cancellation or refund. Review and final reversal policy are pending.

Use test series with dedicated, test-only inventory. A platform buyback offer references one copy, account, expiry and integer price. Peer sales and Vault Credit belong to Poke-Collect. Cardbit uses independent shop credentials and the existing allocator. Cross-store allocation of the same physical item requires an authoritative reservation adapter before either site lists that shared stock. Send the Cardbit order confirmation snippet for merchant review before applying it to store-wide notifications.

### Staff pricing desk

Open **Cardbit Mystery Packs → Pricing desk** in the Cardbit Shopify admin. The same link on a pack series opens its own quantities. The route requires an authenticated admin session for the configured Cardbit shop. The dedicated application uses the existing Card Broker variant-offers reader. Draft series use configured quantities. Launched series count complete groups of remaining unclaimed, nonvoided slots. Unknown quotes stay visible as missing.

**Saved planning pools** reads dated, buylist-qualified snapshots from the merchant shop's `cardbit_staff_pricing.catalog_v1` JSON metafield. Storefront and customer-account access on its definition must both be NONE. The envelope contains gzip-compressed, base64-encoded catalog JSON in `data` and a SHA-256 of the decompressed bytes in `sha256`. Keep actual catalogs and acquisition quotes out of the source repository. With no snapshot, the desk still opens app series.

Choose a pool, edit the price, return target, buyback exceptions, printing values or modeled quantities, then choose **Apply to preview** and **Save staff draft**. App-installation metafields persist validated scenarios using compare-and-set; a stale editor can export its changes before reloading. These scenarios have no connection to inventory allocation, storefront offers, or wallet transactions. Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` before deployment.

## Numbered vault storage and staff fulfillment

The Cardbit owner opens **Orders** and **Storage slots** in Card Broker. A fresh vault starts with 500 numbered dividers, up to 20 sleeved raw cards each. Shelf addresses assume 20 dividers per box and five boxes per shelf. A pool position and a numbered storage slot are separate records. Each digital transfer keeps the physical address. Ordinary cards need no physical identifier when the printing is distinguishable within the divider.

Card Broker records a newly listed variant's opening physical stock and applied positive merchandise receipts in the stock transaction. A durable outbox resends each receipt with the same event key. Shopify availability snapshots, price updates, sales and buybacks do not create physical copies. The first intake starts shelf enforcement for new pool allocations. Legacy awards without a recorded copy need physical reconciliation. Staff confirm put-away under **Storage slots**. One divider excludes matching normalized names or matching game, set and collector number across condition and foil variants. A compatible occupied divider takes precedence over an empty divider, followed by the lowest available number.

**Orders** reads real Shopify orders and real Cardbits pack receipts from the verified Cardbit installation. Select a paid merchant-managed shipping fulfillment, create the pick list, match each copy and confirm packing. The shop's Shopify Shipping package, packed weight, ship time and selected service determine postage. Use **Open in Shopify** to compare postage prices and configure packages. Purchase once, check the label and print. Fulfill with tracking or reconcile an existing Shopify fulfillment. Exact vaulted copies stay occupied until the confirmed physical shipment. Shopify digital fulfillment on an original pack order does not release an address. Current Shopify order history is limited to the installation's approved scopes.

Apply the Cardbit Packs migration before the private Card Broker migration. Deploy the additional Cardbit fulfillment webhook subscriptions with the Cardbit Shopify app configuration. Both services already use an owner-scoped shared connection. Run the private Card Broker suite with separate disposable PostgreSQL databases for the application and its backup-restore test. Rehearse one intake and shipment using an authorized test installation before releasing. A response lost during a postage purchase needs verification in Shopify billing before another purchase. No historical import runs on deployment.
