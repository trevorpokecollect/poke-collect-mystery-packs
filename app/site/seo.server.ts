// Search engines (Shopify-gap audit, Trevor Nov 25 2026: "let Google find the site").
// Public pages are indexable with a canonical link to SITE_ORIGIN (https://cardbit.com), so the Railway
// host never competes with it. Account, checkout and staff pages stay noindex. robots.txt blocks every
// non-canonical host and lists the sitemap. CARDBIT_SITE_INDEXING=off turns indexing off everywhere.

/** First path segments that are public storefront pages. */
export const PUBLIC_BASES = new Set(["", "packs", "chase", "shop", "help", "welcome", "rewards", "leaderboard", "policies", "official-rules"]);

export function siteOrigin(env: NodeJS.ProcessEnv = process.env) {
  try {
    if (env.SITE_ORIGIN) return new URL(env.SITE_ORIGIN).origin;
  } catch {
    /* default below */
  }
  return "https://cardbit.com";
}

export const indexingOn = (env: NodeJS.ProcessEnv = process.env) => env.CARDBIT_SITE_INDEXING !== "off";

const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** <meta name="robots"> plus, for indexable pages, <link rel="canonical">. `path` starts with "/". */
export function robotsTags(path: string | null, env: NodeJS.ProcessEnv = process.env): string {
  if (!path || !indexingOn(env)) return `<meta name="robots" content="noindex, nofollow">`;
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return `<meta name="robots" content="index, follow">\n    <link rel="canonical" href="${attr(siteOrigin(env) + clean)}">`;
}

/** Is this site path a public page (for the storefront shell)? */
export function isPublicPath(path: string) {
  const base = path.replace(/^\/+/, "").split("/")[0];
  return PUBLIC_BASES.has(base);
}

export function robotsTxt(host: string, env: NodeJS.ProcessEnv = process.env) {
  const origin = siteOrigin(env);
  const canonicalHost = new URL(origin).host;
  if (!indexingOn(env) || host.toLowerCase() !== canonicalHost) return "User-agent: *\nDisallow: /\n";
  return [
    "User-agent: *",
    "Disallow: /account", "Disallow: /orders", "Disallow: /shipments", "Disallow: /vault", "Disallow: /binder",
    "Disallow: /openings", "Disallow: /cardbits", "Disallow: /checkout", "Disallow: /sign-in", "Disallow: /api/",
    "Disallow: /staff", "Disallow: /internal", "Disallow: /site/webhooks", "Disallow: /webhooks", "Disallow: /proxy",
    "Disallow: /app", "Disallow: /auth", "Disallow: /jobs",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

export function sitemapXml(env: NodeJS.ProcessEnv = process.env, lastmod = new Date().toISOString().slice(0, 10)) {
  const origin = siteOrigin(env);
  const paths = ["/", "/packs", "/chase", "/shop", "/help", "/rewards", "/leaderboard", "/welcome", "/policies", "/official-rules"];
  const url = (p: string) => `  <url><loc>${origin}${p === "/" ? "/" : p}</loc><lastmod>${lastmod}</lastmod></url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map(url).join("\n")}\n</urlset>\n`;
}
