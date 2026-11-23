// Checks the Mystery Packs app (Vault Market) for a real listing, for the "List A Card On Vault
// Marketplace" daily task (action config `verifyMarketListing`). The packs app answers
// GET <MARKET_VERIFY_URL>?shop=&email=&since=<ISO>[&customer=] with { listed: boolean } when the
// request carries the shared MARKET_VERIFY_SECRET in the x-verify-secret header. Both values are
// Railway variables; the secret is never committed.

const TIMEOUT_MS = 6000;

/** true / false, or null when the packs app can't be asked (not set up, down, bad reply). */
export async function marketListedSince(
  shop: string,
  email: string,
  since: Date,
  shopifyCustomerId?: string | null,
) {
  const base = process.env.CARDBIT_GIVEAWAY_MARKET_VERIFY_URL?.trim();
  const secret = process.env.CARDBIT_GIVEAWAY_MARKET_VERIFY_SECRET?.trim();
  if (!base || !secret) return null;
  const url = new URL(base);
  url.searchParams.set("shop", shop);
  url.searchParams.set("email", email);
  url.searchParams.set("since", since.toISOString());
  if (shopifyCustomerId) url.searchParams.set("customer", shopifyCustomerId);
  try {
    const res = await fetch(url, {
      headers: { "x-verify-secret": secret, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as { listed?: unknown };
    if (!res.ok || typeof body.listed !== "boolean") {
      console.warn(`[market-verify] check failed: ${res.status}`);
      return null;
    }
    return body.listed;
  } catch (e) {
    console.warn(`[market-verify] check failed: ${String(e)}`);
    return null;
  }
}
