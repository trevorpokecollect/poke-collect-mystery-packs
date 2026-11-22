#!/usr/bin/env bash
# Deploys the Cardbit Mystery Packs app config + extensions (docs/CARDBIT.md). The UI extensions and the pack odds
# block have the Poke-Collect backend URL built in, so this rewrites them to cardbit's backend in a throwaway copy
# first. Never run `shopify app deploy --config cardbit` from the main checkout: cardbit's checkout would call
# Poke-Collect's server.
set -euo pipefail
PC_URL="https://app-production-9bd21.up.railway.app"
CB_URL="$(grep '^application_url' shopify.app.cardbit.toml | cut -d'"' -f2)"
[ -n "$CB_URL" ] || { echo "No application_url in shopify.app.cardbit.toml"; exit 1; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
rsync -a --exclude node_modules --exclude .git --exclude build ./ "$TMP/"
cd "$TMP"
grep -rl "$PC_URL" extensions --exclude-dir=node_modules --exclude-dir=dist | xargs sed -i '' "s#$PC_URL#$CB_URL#g"
sed -i '' "s#'https://poke-collect.com'#'https://cardbit.com'#" extensions/pack-reveal/src/ThankYou.jsx
if grep -rq "$PC_URL" extensions --exclude-dir=node_modules --exclude-dir=dist; then echo "Poke-Collect URL still present"; exit 1; fi
npm ci --no-audit --no-fund >/dev/null
npx shopify app deploy --config cardbit --allow-updates --message "${1:-Cardbit deploy}"
