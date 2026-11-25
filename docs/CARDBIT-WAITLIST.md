# Cardbit coming-soon waitlist

Trevor, Nov 25 2026. Until launch the waitlist replaces cardbit.com for the public.

- **Switch:** `CARDBIT_WAITLIST=on` on `cardbit-mystery-packs / site / app-site`. Off = the normal site.
- **Staff preview:** set `CARDBIT_PREVIEW_KEY` (16+ random characters), then open `https://cardbit.com/?preview=<key>` once per browser (30-day cookie). `?preview=off` removes it. Rotating the key logs every preview browser out.
- **Gated:** `/` (waitlist page), storefront pages (`$.tsx`, rewards, leaderboard, club, checkout, limits) redirect to `/`; customer APIs (store, play, rewards, welcome, portfolio, giveaway, chat) return 403 `code: "waitlist"`. **Not gated:** policies, official rules, verified shuffle, sign-in/OAuth, webhooks, staff/internal routes, `/api/waitlist`, `/api/recent`, `/api/pulse`.
- **Signup:** `POST /api/waitlist` → `SiteWaitlist` (app/site/waitlist/waitlist.server.ts). Email consent required; text consent only with a phone. Gmail dots/+tags normalized, disposable domains refused, 5 signups/hour/IP, honeypot.
- **Klaviyo:** 5-minute sync sets profile properties (`founding_collector`, `cardbit_waitlist`, utm) and subscribes email to `KLAVIYO_WAITLIST_LIST_ID` (falls back to the Email List). Text consent is sent only once `KLAVIYO_SMS_LIST_ID` is set.
- **Founding Collector bonus:** badge (customer tag `founding-collector`) + 1,000 Cardbits (400 email, 600 confirmed phone), unlocked by the first processor-confirmed top-up on an account with the same email. Replaces Welcome Rewards (already-paid 200/300 are subtracted). One per email key and per phone. Refund/chargeback of that top-up removes it. `/api/welcome` returns `founding`.
- **Page:** app/site/waitlist/page.server.ts + public/site/waitlist/waitlist.{css,js}. No libraries; reduced-motion fallback.
- **Ads:** Lead/SubmitForm/generate_lead fire only if a pixel is already loaded (consent banner from the ad-pixels branch).
