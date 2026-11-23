# Cardbit Giveaways

This release adds Giveaways to the Cardbit owner workspace and uses the existing Cardbit Mystery Packs database and wallet. Both application patches belong together. The daily draw starts paused.

## Customer rules

| Action | Entries | When it counts |
| --- | ---: | --- |
| Enter today | 1 | Once per draw after signing in, subscribing to email marketing and completing Whatnot |
| Visit the Poke-Collect Whatnot invite | 100 | Once per Cardbit account. The visit unlocks future drawings and an unused bonus follows the customer to their first daily entry |
| Visit Cardbit on Facebook | 50 | Optional, once per account |
| Visit Cardbit on Instagram | 50 | Optional, once per account |
| Share the giveaway | 100 | Once per draw across all sharing methods |
| Refer a customer who purchases | 500 | Paid to the referrer once per referred customer after a qualifying purchase |
| Buy Cardbits | 1 per 100 | Based on verified paid principal. A 10,000 top-up with 500 promotional Cardbits earns 100 entries |

The draw runs from 8 p.m. to 8 p.m. in America/Chicago, including daylight-saving changes. A customer must enter that draw for their entries to count. The account records age 18 or older and a residence in one of the 50 states or DC. Email consent is read from Shopify at entry and again before selection.

The Whatnot invite is https://whatnot.com/invite/pokecollectcards. Social visits use outbound clicks. Native mobile sharing records completion of the share sheet. The desktop fallback opens an email draft and asks the customer to confirm that they shared. External platforms do not attest that a visitor followed an account or published a share.

The referrer receives entries in the draw open when the purchase is recorded. A qualifying purchase is an externally captured Cardbit checkout from an approved gateway or a completed wallet-paid pack. An enabled giveaway can record paid entries before the customer checks in. Wallet prizes, buybacks, free credits, checkout redirects and promotional top-up credits do not earn purchase entries. Refund and cancellation review voids pending order entries. A reversal reported after a settled draw is recorded for owner review.

## Customer and owner surfaces

The customer page runs at `/apps/packs/giveaways` on the Cardbit storefront. It uses the existing signed Shopify app proxy. The page includes eligibility, daily check-in, balances by entry source, referral links, shares, and recent draw outcomes. The new Daily Cardbit giveaway theme block links to it.

On `cardbit.cardbroker.app/staff/cardbit`, select **Giveaways**. The daily desk shows entry sources, customer activity, account holds, free-entry and manual adjustments, CSV exports, draw history, downloadable audit proofs and promotion settings. A proof contains the original seed, seed commitment, eligible pseudonymous ticket weights, and snapshot hash. Replaying the original Poke-Collect HMAC draw on those weights reproduces the winner. Customer details stay in the owner workspace.

**Campaign manager** opens the adapted Poke-Collect campaign tools inside Card Broker. These include the campaign editor and storefront preview, manual/custom campaigns, prize queues, eligibility review, entrant search and history, CSV import/export, analytics, linked campaigns, draw history, and winner communication. Inherited customer widgets include the campaign page, pop-up, winners feed, product/cart estimates and thank-you/order-status extensions. Each external integration requires Cardbit credentials. Advanced campaign credentials, physical-prize reservations and external notification delivery have not been exercised against a hosted store during this build.

The Cardbit theme's homepage button reads the signed proxy's prompt status. Clicking **Join Today's Giveaway** submits an entry for the displayed draw. A repeated request returns the one-entry receipt. A request for a drawing that has already closed prompts the customer to join the next one. Sign-in, email marketing consent, adult eligibility and the one-time Whatnot visit still apply. A visitor's browser cannot choose the customer or the entry count.

## Architecture and access

- Mystery Packs owns daily entries, Shopify consent checks, the draw, the payout, and immutable financial receipts. Non-daily campaign features reuse the original campaign engine. Card Broker owns staff sessions and the daily management interface. No new app installation, Railway service, wallet or database is required for the daily feature.
- Owner traffic follows the existing Cardbit host, tenant and owner checks. Advanced campaign requests use the same authenticated staff bridge. The browser bundle contains the editor views. Database access and Shopify credentials stay on the server.
- Dedicated PostgreSQL locks serialize daily entry and payout writes. Uniqueness covers repeat clicks, daily shares, credited orders and draw receipts. Winner selection, the 10,000-Cardbit wallet credit and the financial receipt commit in one transaction. A draw with zero eligible entrants closes without a payout.
- The existing Cardbit service checks for elapsed draws every minute and retries on restart. A database lease coordinates workers. The authenticated `POST /jobs/cardbit-giveaways` route and the owner’s **Process due draws** control provide recovery. An additional scheduler is optional.
- Set a Cardbit Klaviyo key with Events write access in `CARDBIT_GIVEAWAY_KLAVIYO_PRIVATE_KEY` to emit the **Cardbit Daily Giveaway Won** event. A Cardbit Klaviyo flow sends the winner email. A deterministic event identifier handles retries. Other provider settings use `CARDBIT_GIVEAWAY_` prefixes in the adapted campaign source. Enable only integrations in use.
- The primary Cardbit-only configuration is `shopify.app.cardbit.toml`. The optional theme and checkout extensions have their own Cardbit identifiers. Cardbit-specific provider settings supersede the originating giveaway app's credentials and attribution defaults.

## Release with numbered fulfillment

The tested Packs sources combine Cardbit at `52b36f5` with numbered vault fulfillment at `fc56eb9` from PR #86. The private Card Broker source includes the fulfillment change at `0b8e24a` on top of `16c0478`. The giveaway patches add to those sources. The existing campaign engine is adapted from `c324980`.

1. Bring the reviewed numbered-vault change into the Cardbit release worktree in each repository. The private handoff includes `check-fulfillment.py` to check both incremental patches and detect later edits in shared files. The private staff guide has a separate incremental patch.
2. On the joined sources, generate the Prisma clients, migrate disposable PostgreSQL databases, run tests, type checking, and production builds in both applications. The native giveaway tests select a fresh schema on each run. GitHub's Cardbit PR suite runs them on its ephemeral PostgreSQL service. The private package includes Mac verification instructions.
3. Release Packs through the Cardbit branch and its own Railway app. Release the private owner changes from Trevor's Mac to the shared Card Broker app. Keep the Cardbit fulfillment webhook subscriptions when releasing the Cardbit Shopify app configuration.
4. Review the hosted customer and owner flows and confirm delivery of a test winner notification. Verify paid-entry credit against a captured Cardbit purchase and an approved gateway. Supply Cardbit's reviewed rules URL and the approved free bonus-entry instructions, then activate the daily drawing in the owner desk.

## Verification

On PostgreSQL 16.15 the new migration applied over an existing numbered-vault database. Its receipt, filed copy, pool binding and pending parcel retained the same values. The signed-in customer and payment checks use simulated Shopify responses in the suite. The native draw test runs two settlements together, verifies one 10,000-Cardbit award and checks the shelf copy and its binding. The physical tests cover conflicting picks, rejected fulfillments and retries. Private owner route tests cover Orders, Storage slots and Giveaways.
