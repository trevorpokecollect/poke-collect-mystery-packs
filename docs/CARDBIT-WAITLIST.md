# Cardbit coming-soon waitlist

Trevor, Nov 25 2026. Until launch the waitlist replaces cardbit.com for the public.

- **Switch:** `CARDBIT_WAITLIST=on` on `cardbit-mystery-packs / site / app-site`. Off = the normal site.
- **Staff preview:** set `CARDBIT_PREVIEW_KEY` (16+ random characters), then open `https://cardbit.com/?preview=<key>` once per browser (30-day cookie). `?preview=off` removes it. Rotating the key logs every preview browser out.
- **Gated:** `/` (waitlist page), storefront pages (`$.tsx`, rewards, leaderboard, club, checkout, limits) redirect to `/`; customer APIs (store, play, rewards, welcome, portfolio, giveaway, chat) return 403 `code: "waitlist"`. **Not gated:** policies, official rules, verified shuffle, sign-in/OAuth, webhooks, staff/internal routes, `/api/waitlist`, `/api/recent`, `/api/pulse`.
- **Signup:** `POST /api/waitlist` → `SiteWaitlist` (app/site/waitlist/waitlist.server.ts). Email consent required; text consent only with a phone. Gmail dots/+tags normalized, disposable domains refused, 5 signups/hour/IP, honeypot.
- **Klaviyo:** 5-minute sync sets profile properties (`founding_collector`, `cardbit_waitlist`, utm) and subscribes email to `KLAVIYO_WAITLIST_LIST_ID` (set it to `QRHzBV`, the "Waitlist (cardbit.com Founding Collectors)" list; falls back to the Email List). Text consent is sent only once `KLAVIYO_SMS_LIST_ID` is set, and only for phones not already in SiteMarketing (no double YES prompts).
- **Account creation:** `adoptWaitlist` (from `upsertCustomer`) claims the spot, tags the customer, and copies email opt-in plus the phone (pending, `smsSource: "waitlist"`) into SiteMarketing so the Klaviyo YES poll and `confirmSms` handle it.
- **Founding Collector bonus:** badge (customer tag `founding-collector`) + 1,000 Cardbits (400 email, 600 confirmed phone), unlocked by the first processor-confirmed top-up on an account with the same email. Replaces Welcome Rewards (already-paid 200/300 are subtracted). One per email key and per phone. Refund/chargeback of that top-up removes it. `/api/welcome` returns `founding`.
- **Page:** app/site/waitlist/page.server.ts + public/site/waitlist/waitlist.{css,js}. No libraries; reduced-motion fallback.
- **Ads:** Lead/SubmitForm/generate_lead fire only if a pixel is already loaded (consent banner from the ad-pixels branch).

## Speed pass (Nov 26 2026)

- Images and the body font come from right-sized copies in `public/site/fast/` (`scripts/site/optimize-fast-assets.py`,
  manifest read by `app/site/fast-assets.ts`). Packs 480 px, cards 400 px (200 px "sm" for small tiles), side packs 300 px.
  Re-run the script after changing a source image. `port-theme.mjs` does not touch this folder.
- Below-the-fold images are `loading="lazy"`; the hero rip cards load after the page `load` event (they stay hidden until
  the first tear); pack foil masks are set when the lineup is near; Ask Latch loads when the page is idle.
- `waitlist.css` no longer blocks the first paint. The branded loader (`app/site/loader.server.ts`) covers the page
  until the stylesheet and DOM are ready (cap 5 s), and `waitlist.js` boots on the `cb:css` event. The loader only
  appears if the page is not ready after 150 ms. The storefront shell uses the same loader until the shop renders.
- app-site starts with `scripts/site/serve.mjs` instead of `react-router-serve`: same server, but `?v=`-versioned
  static files get `Cache-Control: public, max-age=31536000, immutable` (was `max-age=0`, so Cloudflare and browsers
  re-checked every file on every visit).
