import { authenticate } from "../shopify.server";
import type { Viewer } from "./pool.server";

/**
 * Authenticates an app proxy request (Shopify signs it) and works out who is asking:
 * a guest holding an order link token (?k=...) or a logged-in customer.
 */
export async function proxyContext(request: Request) {
  const context = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const token = url.searchParams.get("k");
  const customer = url.searchParams.get("logged_in_customer_id");
  const viewer: Viewer | null = token
    ? { openToken: token }
    : customer
      ? { customerId: `gid://shopify/Customer/${customer}` }
      : null;
  const shop = context.session?.shop ?? url.searchParams.get("shop") ?? "";
  return { ...context, shop, viewer };
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
