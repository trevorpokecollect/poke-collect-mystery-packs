#!/bin/sh
# This entry point belongs to the Cardbit release. Local development uses npm run dev.
set -eu
# The stripe-test environment has its own guarded entry point (test keys, its own database).
if [ "${RAILWAY_ENVIRONMENT_NAME:-}" = "stripe-test" ]; then
  exec sh scripts/start-cardbit-stripe-test.sh
fi
if [ "${RAILWAY_PROJECT_ID:-}" != "c64fd4e8-87ee-486c-add4-e19daa64cbfc" ] ||
   [ "${RAILWAY_SERVICE_ID:-}" != "52a62514-0af0-4aa0-b830-bb1028c8ee1d" ] ||
   [ "${RAILWAY_ENVIRONMENT_ID:-}" != "32bd118c-f17e-4429-b33c-58f51966c664" ] ||
   [ "${RAILWAY_GIT_BRANCH:-}" != "cardbit" ]; then
  echo "Cardbit startup requires the cardbit branch on cardbit-mystery-packs / production / app." >&2
  exit 1
fi
export CARDBIT_STOREFRONT_SHOP=hhuuev-81.myshopify.com
exec npm run docker-start
