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

## Cardbits testing

The ledger and buybacks are opt-in. Use a private test service/database with the exact Shopify test configuration approved by the merchant. Set `CARDBIT_COMMERCE_MODE=staging`, `CARDBIT_QA_CUSTOMERS` (comma-separated Shopify customer GIDs), `CARDBIT_TEST_GATEWAY` (exact gateway reported on the Shopify test sale), `CARDBIT_TEST_TOPUPS` (JSON mapping variant GIDs to integer Cardbits) and `CARDBIT_TEST_SERIES` (JSON mapping staff-test series handles to integer prices). The test exchange convention is 100 Cardbits per USD. Leave staging commerce disabled on the production app. Top-ups require a verified fully paid test checkout and successful test transactions. Funding review holds the balance on cancellation or refund. Review and final reversal policy are pending.

Use test series with dedicated, test-only inventory. A platform buyback offer references one copy, account, expiry and integer price. Peer sales and Vault Credit belong to Poke-Collect. Cardbit uses independent shop credentials and the existing allocator. Cross-store allocation of the same physical item requires an authoritative reservation adapter before either site lists that shared stock. Send the Cardbit order confirmation snippet for merchant review before applying it to store-wide notifications.
