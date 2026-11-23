import widgetCss from "../../../../../../extensions/mystery-packs-theme/assets/giveaway.css?raw";
import widgetJs from "../../../../../../extensions/mystery-packs-theme/assets/giveaway.js?raw";

// Hosted giveaway page at /apps/packs/campaigns/<slug>, opened directly in the browser.
// Returned as application/liquid so Shopify renders it inside the store's theme (header,
// footer, fonts), with the same widget the theme block uses mounted in the middle.

/** True for a browser navigation; the widget's own fetches ask for JSON. */
export function wantsLandingPage(request: Request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.searchParams.get("format") === "json") return false;
  if (request.headers.get("x-entrant-token")) return false;
  return (request.headers.get("accept") ?? "").includes("text/html");
}

// Escapes HTML and the Liquid delimiters, so merchant text can't run as Liquid.
const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/{/g, "&#123;")
    .replace(/}/g, "&#125;");

// {% raw %} keeps Liquid away from the widget's code; it only has to avoid the end tag.
const raw = (s: string) =>
  `{% raw %}${s.replace(/{%-?\s*endraw\s*-?%}/g, "")}{% endraw %}`;

export interface LandingInput {
  slug: string;
  /** From Shopify's path_prefix query param, e.g. /apps/packs/campaigns. */
  pathPrefix?: string | null;
  campaign?: { title: string; prize?: string | null } | null;
}

export function landingPage({ slug, pathPrefix, campaign }: LandingInput) {
  // The prefix is merchant-configurable; only accept a plain path.
  const prefix =
    pathPrefix && /^\/[\w\-/]+$/.test(pathPrefix)
      ? pathPrefix.replace(/\/$/, "") + "/campaigns"
      : "/apps/packs/campaigns";
  const title = campaign?.title ?? "Giveaway";
  const lead = campaign?.prize
    ? `Enter for a chance to win ${campaign.prize}.`
    : "Enter free for a chance to win.";

  const liquid = `
{%- comment -%} Cardbit Giveaways hosted page {%- endcomment -%}
<style>${raw(widgetCss)}</style>
<div class="pcg-page">
  <header class="pcg-page__intro">
    <p class="pcg-page__eyebrow">Cardbit Giveaways</p>
    <h1 class="pcg-page__title">${esc(title)}</h1>
    <p class="pcg-page__lead">${esc(lead)}</p>
  </header>
  <div class="pcg" data-pcg data-slug="${esc(slug)}" data-proxy="${esc(prefix)}" data-page="1">
    <div class="pcg__loading" aria-live="polite">Loading giveaway…</div>
  </div>
  <p class="pcg-page__foot">No purchase necessary. <a href="{{ routes.root_url }}">Keep shopping</a></p>
</div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
<script>${raw(widgetJs)}</script>
`;
  return new Response(liquid, {
    headers: {
      "Content-Type": "application/liquid",
      "Cache-Control": "no-store",
    },
  });
}
