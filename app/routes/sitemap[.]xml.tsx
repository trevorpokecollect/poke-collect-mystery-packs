// sitemap.xml for the standalone site's public pages (see app/site/seo.server.ts). 404 when the site is off.
import { SITE_ENABLED, notFound } from "../site/shell.server";
import { indexingOn, sitemapXml } from "../site/seo.server";

export const loader = () =>
  SITE_ENABLED() && indexingOn()
    ? new Response(sitemapXml(), { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } })
    : notFound();
