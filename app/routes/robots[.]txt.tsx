// robots.txt for the standalone site (see app/site/seo.server.ts). 404 when the site is off.
import type { LoaderFunctionArgs } from "react-router";
import { SITE_ENABLED, notFound } from "../site/shell.server";
import { robotsTxt } from "../site/seo.server";

export const loader = ({ request }: LoaderFunctionArgs) => {
  if (!SITE_ENABLED()) return notFound();
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host).split(",")[0].trim();
  return new Response(robotsTxt(host), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
};
