/** Standalone site: send www.<host> to the canonical SITE_ORIGIN host (301, path + query kept). */
export function canonicalRedirect(request: Request, env: NodeJS.ProcessEnv = process.env): Response | null {
  if (env.CARDBIT_SITE !== "on" || !env.SITE_ORIGIN) return null;
  let canonical: URL;
  try {
    canonical = new URL(env.SITE_ORIGIN);
  } catch {
    return null;
  }
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").toLowerCase().split(",")[0].trim();
  if (host !== `www.${canonical.host}`) return null;
  const url = new URL(request.url);
  return new Response(null, { status: 301, headers: { Location: `${canonical.origin}${url.pathname}${url.search}` } });
}
