import type { LoaderFunctionArgs } from "react-router";
import { proxyContext } from "../lib/proxy.server";

// Rendered inside the store theme at /apps/packs. The page shell is Liquid so it
// picks up the theme's header and footer; the opener script does the rest.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { liquid, viewer } = await proxyContext(request);
  const assets = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");

  if (!viewer) {
    return liquid(
      `<div class="mp-page mp-signin">
        <h1>My Packs</h1>
        <p>Log in to see and open your mystery packs, or use the link in your order email.</p>
        <a class="button" href="{{ routes.account_login_url }}?return_url=/apps/packs">Log In</a>
      </div>`,
    );
  }

  return liquid(
    `<link rel="stylesheet" href="${assets}/packs/opener.css">
     <div class="mp-page" id="mystery-packs" data-api="/apps/packs/api"></div>
     <script src="${assets}/packs/opener.js" defer></script>`,
  );
};
