import type { LoaderFunctionArgs } from "react-router";
import { createHash, timingSafeEqual } from "node:crypto";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";

// Giveaway check (Trevor 2026-10-19): has this customer listed a vault card on Vault Market since a time? For the
// giveaway app's "List A Card On Vault Marketplace" daily task. Read-only, answers only { listed: boolean }.
//   GET /api/giveaway/market-listed?shop=<shop>&email=<email>&since=<ISO>[&customer=<gid or numeric id>]
// Auth: x-verify-secret must equal MARKET_VERIFY_SECRET. Any listing created since counts, even if it later sold or
// was cancelled. The email is matched to Shopify customers (listings store the customer id, not the email).
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
const digest = (s: string) => createHash("sha256").update(s).digest();

// 120 requests a minute per IP, kept in memory (one app instance).
const hits = new Map<string, { n: number; reset: number }>();
function limited(ip: string, now = Date.now()) {
  const h = hits.get(ip);
  if (!h || now > h.reset) {
    hits.set(ip, { n: 1, reset: now + 60_000 });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  h.n += 1;
  return h.n > 120;
}

const gid = (id: string) =>
  /^\d+$/.test(id) ? `gid://shopify/Customer/${id}` : id;

async function customerIdsForEmail(shop: string, email: string) {
  const { admin } = await unauthenticated.admin(shop);
  const res = await admin.graphql(
    `#graphql
    query GiveawayCustomerByEmail($q: String!) { customers(first: 5, query: $q) { nodes { id email } } }`,
    { variables: { q: `email:"${email.replace(/["\\]/g, "")}"` } },
  );
  const body = (await res.json()) as {
    data?: { customers?: { nodes: { id: string; email: string | null }[] } };
  };
  return (body.data?.customers?.nodes ?? [])
    .filter((c) => c.email?.toLowerCase() === email.toLowerCase())
    .map((c) => c.id);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret = process.env.MARKET_VERIFY_SECRET ?? "";
  if (!secret) return json({ error: "not configured" }, 503);
  const sent = request.headers.get("x-verify-secret") ?? "";
  // Hashing both sides first keeps the compare constant-time whatever the lengths.
  if (!sent || !timingSafeEqual(digest(sent), digest(secret)))
    return json({ error: "unauthorized" }, 401);
  const ip =
    (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    "unknown";
  if (limited(ip)) return json({ error: "rate limited" }, 429);

  const url = new URL(request.url);
  const shop = (url.searchParams.get("shop") ?? "").trim();
  const email = (url.searchParams.get("email") ?? "").trim();
  const customer = (url.searchParams.get("customer") ?? "").trim();
  const since = new Date(url.searchParams.get("since") ?? "");
  if (
    !shop.endsWith(".myshopify.com") ||
    (!email && !customer) ||
    email.length > 320 ||
    Number.isNaN(since.getTime())
  )
    return json(
      {
        error:
          "shop, email (or customer) and since (ISO datetime) are required",
      },
      400,
    );

  const ids = new Set<string>(customer ? [gid(customer)] : []);
  if (email)
    for (const id of await customerIdsForEmail(shop, email)) ids.add(id);
  if (!ids.size) return json({ listed: false });

  const found = await db.listing.findFirst({
    where: {
      shop,
      sellerCustomerId: { in: [...ids] },
      createdAt: { gte: since },
    },
    select: { id: true },
  });
  return json({ listed: !!found });
};
