import type { LoaderFunctionArgs } from "react-router";
import { proxyContext } from "../lib/proxy.server";
import { enabled } from "../workspace/mode.server";
import html from "../giveaway/storefront/surface.html?raw";
import css from "../giveaway/storefront/surface.css?raw";
import script from "../giveaway/storefront/surface.js?raw";
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, liquid } = await proxyContext(request);
  if (!enabled(shop)) throw new Response("Page unavailable", { status: 404 });
  return liquid(
    "<style>" + css + "</style>" + html + "<script>" + script + "</script>",
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
