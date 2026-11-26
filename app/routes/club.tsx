// The plan was renamed "Pack Pass" (Trevor, Nov 25 2026): /club permanently redirects to /pass.
import type { LoaderFunctionArgs } from "react-router";

export function loader({ request }: LoaderFunctionArgs) {
  if (process.env.CARDBIT_SITE !== "on") return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  return new Response(null, { status: 301, headers: { Location: `/pass${url.search}` } });
}
