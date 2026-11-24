#!/bin/sh
# Stripe top-up test service only: cardbit-mystery-packs / stripe-test, test keys, its own database.
# Never the production environment, never live keys, no Shopify Admin access.
set -eu
if [ "${RAILWAY_PROJECT_ID:-}" != "c64fd4e8-87ee-486c-add4-e19daa64cbfc" ] ||
   [ "${RAILWAY_ENVIRONMENT_NAME:-}" != "stripe-test" ] ||
   [ "${RAILWAY_ENVIRONMENT_ID:-}" = "32bd118c-f17e-4429-b33c-58f51966c664" ]; then
  echo "This entry point runs only in cardbit-mystery-packs / stripe-test." >&2
  exit 1
fi
case "${STRIPE_SECRET_KEY:-}" in
  sk_test_*|rk_test_*) ;;
  *) echo "stripe-test requires a Stripe test-mode secret key." >&2; exit 1 ;;
esac
if [ -n "${CARDBIT_WORKSPACE_MODE:-}" ] || [ -n "${CARDBIT_STRIPE_LIVE_APPROVED:-}" ]; then
  echo "stripe-test must not set CARDBIT_WORKSPACE_MODE or CARDBIT_STRIPE_LIVE_APPROVED." >&2
  exit 1
fi
export CARDBIT_STOREFRONT_SHOP=hhuuev-81.myshopify.com
exec npm run docker-start
