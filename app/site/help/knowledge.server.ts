// Ask Latch knowledge: the published site pages, turned into plain text once per process.
// The bot may only answer from this text, so it stays in sync with How It Works, the FAQ, Policies
// and the Official Rules automatically (same partials the pages render).
import howItWorks from "../partials/how-it-works.html?raw";
import policies from "../partials/policies.html?raw";
import { waitlistPage } from "../waitlist/page.server";
import { subscriptionsReady } from "../payments/coinflow-subscriptions.server";
import { withPlanCopy } from "../play/plan-brand";
import { siteFacts } from "./facts.server";

const optional = import.meta.glob("../partials/official-rules.html", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const officialRules = optional["../partials/official-rules.html"] ?? "";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…", middot: "·", eacute: "é", trade: "™", reg: "®", copy: "©", times: "×" };

/** Readable text from page HTML: headings become "## ", list items "- ", scripts/styles/hidden bits dropped. */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|svg|noscript)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(h[1-6])\b[^>]*>/gi, (_m, h: string) => `\n\n${"#".repeat(Math.min(Number(h[1]) + 1, 4))} `)
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<summary\b[^>]*>/gi, "\nQ: ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|ul|ol|tr|table|summary|details|dd|dt|header|footer|main|blockquote)>/gi, "\n")
    .replace(/<a\b[^>]*href="(mailto:[^"]+|\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      const target = href.startsWith("/") ? `cardbit.com${href}` : href.replace(/^mailto:/i, "");
      return text && !text.toLowerCase().includes(target.toLowerCase()) ? `${text} (${target})` : text || target;
    })
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The waitlist page itself is the source for Founding Collector terms; this note only adds what the bot
// must never invent.
const WAITLIST_NOTE = `- Cardbit is Launching Soon. There is no announced launch date; never guess one.
- Until launch nobody can buy Cardbits or open packs.`;

let cached: string | null = null;

/** All reference text, stable byte-for-byte within a deploy (so the prompt cache hits). */
export function knowledge(): string {
  if (cached) return cached;
  const plans = subscriptionsReady();
  const parts = [
    ["HOW IT WORKS AND FAQ (cardbit.com/help)", htmlToText(withPlanCopy(howItWorks, plans))],
    ["SITE FACTS (from the systems that run cardbit.com: rewards, leaderboard, Sparks, limits, Verified Shuffle, plans)", siteFacts(plans)],
    ["POLICIES (cardbit.com/policies)", htmlToText(withPlanCopy(policies, plans))],
    ["OFFICIAL RULES (cardbit.com/official-rules)", officialRules ? htmlToText(officialRules) : ""],
    ["COMING-SOON WAITLIST PAGE (cardbit.com before launch)", `${htmlToText(waitlistPage())}\n\n${WAITLIST_NOTE}`],
  ].filter(([, text]) => text);
  cached = parts.map(([title, text]) => `<page title="${title}">\n${text}\n</page>`).join("\n\n");
  return cached;
}
