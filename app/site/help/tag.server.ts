// Script + stylesheet tags for Ask Latch (public/site/js/cardbit-site-help.js). Kept apart from help.server.ts so
// pages can include the widget without importing the knowledge text (the waitlist page is part of it).
import { createHash } from "node:crypto";
import helpSource from "../../../public/site/js/cardbit-site-help.js?raw";
import helpCssSource from "../../../public/site/css/cardbit-site-help.css?raw";

const v = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 10);
const JS_V = v(helpSource);
const CSS_V = v(helpCssSource);

// Same switch as help.server.ts helpOn(): the widget shows only when the API can answer.
const on = (env: NodeJS.ProcessEnv) => (env.SITE_HELP === "on" || env.SITE_HELP === "staff") && !!(env.ANTHROPIC_API_KEY || "").trim();

/** Widget tags, or "" when Ask Latch is off. iconUrl = Latch art; mode tells the widget which page it is on. */
export function helpTags(mode: "site" | "waitlist", iconUrl: string, env: NodeJS.ProcessEnv = process.env, opts: { lazy?: boolean } = {}): string {
  if (!on(env)) return "";
  const staff = env.SITE_HELP === "staff";
  if (opts.lazy) {
    // Speed pass (Nov 26 2026): load the widget after the page has loaded and gone idle, so its CSS never blocks
    // the first paint and its script never competes with the hero images.
    const cfg = JSON.stringify({ css: `/site/css/cardbit-site-help.css?v=${CSS_V}`, js: `/site/js/cardbit-site-help.js?v=${JS_V}`, mode, icon: iconUrl, staff }).replace(/</g, "\\u003c");
    return `<script>(function(c){function go(){var l=document.createElement('link');l.rel='stylesheet';l.href=c.css;document.head.appendChild(l);var s=document.createElement('script');s.src=c.js;s.dataset.mode=c.mode;s.dataset.icon=c.icon;if(c.staff)s.dataset.staff='1';document.head.appendChild(s);}function idle(){(window.requestIdleCallback||function(f){setTimeout(f,1200)})(go,{timeout:3000});}if(document.readyState==='complete')idle();else addEventListener('load',idle);})(${cfg});</script>`;
  }
  return `<link rel="stylesheet" href="/site/css/cardbit-site-help.css?v=${CSS_V}">\n    <script src="/site/js/cardbit-site-help.js?v=${JS_V}" data-mode="${mode}" data-icon="${iconUrl}"${staff ? ' data-staff="1"' : ""} defer></script>`;
}
