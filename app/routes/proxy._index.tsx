import type { LoaderFunctionArgs } from "react-router";
import { proxyContext } from "../lib/proxy.server";

// Rendered inside the store theme at /apps/packs. The page shell is Liquid so it
// picks up the theme's header and footer; the opener script does the rest.
// Shown instantly when arriving from checkout (?open=1) and removed once the opening stage is up,
// so the packs list never flashes first. Inline so it applies before any stylesheet loads.
const COVER = `<div id="mp-cover" style="position:fixed;inset:0;z-index:9998;display:grid;place-items:center;background:radial-gradient(circle at 50% 45%,#2b2140 0%,#0b0a12 70%);color:#c9c6d8;font:600 15px/1.4 system-ui,sans-serif;letter-spacing:.04em">Getting your pack ready…</div>`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { liquid, viewer } = await proxyContext(request);
  const assets = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const opening = new URL(request.url).searchParams.get("open") === "1";

  if (!viewer) {
    return liquid(
      `<div class="mp-page mp-signin">
        <h1>My Packs</h1>
        <p>Log in to see and open your mystery packs, or use the link in your order email.</p>
        <a class="button" href="{{ routes.account_login_url }}?return_url=/apps/packs">Log in</a>
      </div>`,
    );
  }

  return liquid(
    `${opening ? COVER : ""}
     <link rel="preload" href="${assets}/packs/opener.js" as="script">
     <link rel="stylesheet" href="${assets}/packs/opener.css">
     <div class="mp-page" id="mystery-packs" data-api="/apps/packs/api"></div>
     <script src="${assets}/packs/opener.js" defer></script>`,
  );
};
