/**
 * Cardbit standalone site: storefront pages (packs, shop, vault, account, Cardbits, How It Works…).
 * Only active when CARDBIT_SITE=on (the `site` Railway environment). Off everywhere else, so the
 * Shopify app and production are unchanged. Named routes (/app, /auth, /api, /proxy…) win over this splat.
 */
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { SITE_ENABLED, htmlResponse, notFound, storefrontShell } from "../site/shell.server";

// First path segment -> page title before the client app takes over.
const PAGES: Record<string, string> = {
  packs: "Shop Packs",
  chase: "Chase",
  shop: "Shop Singles",
  "ship-together": "Ship Together",
  account: "My Account",
  orders: "My Orders",
  shipments: "Shipments",
  vault: "My Vault",
  binder: "My Vault",
  openings: "Saved Pack Opening",
  cardbits: "My Cardbits",
  help: "How It Works",
  demo: "Demo Opening",
  open: "Demo Opening",
  welcome: "Welcome Rewards",
  "collector-profiles": "Collector Profile",
  latch: "Pack Opening",
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  if (!SITE_ENABLED()) return notFound();
  const path = (params["*"] ?? "").replace(/\/+$/, "");
  const base = path.split("/")[0];
  if (base === "how-it-works") throw redirect("/help");
  // Old Shopify cardbit.com paths (cutover): permanent redirects to their new homes.
  const legacy = legacyRedirect(path);
  if (legacy) return new Response(null, { status: 301, headers: { Location: legacy } });
  const title = PAGES[base];
  if (!title) return htmlResponse(storefrontShell({ title: "Page Unavailable · cardbit" }), 404);
  void request;
  return htmlResponse(storefrontShell({ title: `${title} · cardbit` }));
};

/** Shopify-era cardbit.com paths → new site paths. Exported for tests. */
export function legacyRedirect(path: string): string | null {
  const [base, rest = ""] = [path.split("/")[0], path.split("/").slice(1).join("/")];
  if (base === "pages") {
    if (rest === "how-it-works") return "/help";
    if (rest === "official-rules") return "/official-rules";
    if (/^(policies|terms|privacy|refund|shipping)/.test(rest)) return "/policies";
    return "/";
  }
  if (base === "policies") return "/policies";
  if (base === "collections") return /pack/.test(rest) ? "/packs" : "/shop";
  if (base === "products") return /top-?up|cardbits/.test(rest) ? "/cardbits" : "/packs";
  if (base === "cart" || base === "checkout" || base === "checkouts") return "/cardbits";
  if (base === "account" && /^(login|register)/.test(rest)) return "/sign-in";
  if (base === "search") return "/shop";
  return null;
}
