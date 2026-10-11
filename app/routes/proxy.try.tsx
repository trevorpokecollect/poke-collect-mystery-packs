import type { LoaderFunctionArgs } from "react-router";
import { proxyContext } from "../lib/proxy.server";
import { OPENER_VERSION } from "../lib/opener-version.server";

// Demo opening for shoppers, linked from the pack product page: /apps/packs/try?product=<id>.
// Plays the real opening animation with a random card from what's left in the pool. Nothing is bought.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { liquid } = await proxyContext(request);
  const assets = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const url = new URL(request.url);
  const params = new URLSearchParams();
  for (const key of ["product", "series"]) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value.replace(/[^\w:/.-]/g, ""));
  }
  return liquid(
    `<link rel="stylesheet" href="${assets}/packs/opener.css?v=${OPENER_VERSION}">
     <div class="mp-page" id="mystery-packs" data-api="/apps/packs/api" data-try="${params.toString().replace(/&/g, "&amp;")}"></div>
     <script src="${assets}/packs/opener.js?v=${OPENER_VERSION}" defer></script>`,
  );
};
