// Script + stylesheet tags for Ask Latch (public/site/js/cardbit-site-help.js). Kept apart from help.server.ts so
// pages can include the widget without importing the knowledge text (the waitlist page is part of it).
import { createHash } from "node:crypto";
import helpSource from "../../../public/site/js/cardbit-site-help.js?raw";
import helpCssSource from "../../../public/site/css/cardbit-site-help.css?raw";

const v = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 10);
const JS_V = v(helpSource);
const CSS_V = v(helpCssSource);

// Same switch as help.server.ts helpOn(): the widget shows only when the API can answer.
const on = (env: NodeJS.ProcessEnv) => env.SITE_HELP === "on" && !!(env.ANTHROPIC_API_KEY || "").trim();

/** Widget tags, or "" when Ask Latch is off. iconUrl = Latch art; mode tells the widget which page it is on. */
export function helpTags(mode: "site" | "waitlist", iconUrl: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!on(env)) return "";
  return `<link rel="stylesheet" href="/site/css/cardbit-site-help.css?v=${CSS_V}">\n    <script src="/site/js/cardbit-site-help.js?v=${JS_V}" data-mode="${mode}" data-icon="${iconUrl}" defer></script>`;
}
