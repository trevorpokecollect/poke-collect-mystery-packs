#!/bin/sh
# Standalone cardbit.com site only: cardbit-mystery-packs / site / app-site, branch cardbit-site,
# its own database, no Shopify credentials, Coinflow sandbox unless Trevor approves live.
set -eu
if [ "${RAILWAY_PROJECT_ID:-}" != "c64fd4e8-87ee-486c-add4-e19daa64cbfc" ] ||
   [ "${RAILWAY_ENVIRONMENT_NAME:-}" != "site" ] ||
   [ "${RAILWAY_ENVIRONMENT_ID:-}" != "4356cf43-d584-4844-981f-dd6276eed503" ] ||
   [ "${RAILWAY_SERVICE_ID:-}" != "593548b9-bcd8-4c1e-8326-18d1eee3fde3" ]; then
  echo "This entry point runs only in cardbit-mystery-packs / site / app-site." >&2
  exit 1
fi
if [ -n "${RAILWAY_GIT_BRANCH:-}" ] && [ "${RAILWAY_GIT_BRANCH}" != "cardbit-site" ]; then
  echo "app-site deploys only the cardbit-site branch." >&2
  exit 1
fi
case "${DATABASE_URL:-}" in
  *postgres*) ;;
  *) echo "app-site needs its own Postgres (DATABASE_URL)." >&2; exit 1 ;;
esac
if [ -n "${CARDBIT_WORKSPACE_MODE:-}" ] || [ -n "${CARDBIT_STRIPE_LIVE_APPROVED:-}" ] || [ -n "${STRIPE_SECRET_KEY:-}" ]; then
  echo "app-site must not carry production workspace or Stripe settings." >&2
  exit 1
fi
if [ "${COINFLOW_ENV:-}" != "sandbox" ] && [ "${CARDBIT_SITE_LIVE_APPROVED:-}" != "yes" ]; then
  echo "app-site runs Coinflow sandbox until Trevor approves live payments." >&2
  exit 1
fi
export CARDBIT_SITE=on
export DAILY_SCHEDULER=off
# Same as `npm run docker-start` (migrations, then serve), with long browser caching for versioned assets.
npm run setup
exec node scripts/site/serve.mjs build/server/index.js
