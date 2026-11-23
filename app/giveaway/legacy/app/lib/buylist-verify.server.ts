// Checks the Cardbit buylist app (poke-collect-singles) for a real submission, for the
// "Submit A Buylist" daily task (action config `verifyBuylist`). The buylist app answers
// GET <BUYLIST_VERIFY_URL>?email=<email>&since=<ISO time>&approved=1 with { submitted: boolean } when the
// request carries the shared BUYLIST_VERIFY_SECRET in the x-verify-secret header. Both values are
// Railway variables; the secret is never committed.

const TIMEOUT_MS = 5000;

/** true / false, or null when the buylist app can't be asked (not set up, down, bad reply). */
export async function buylistSubmittedSince(email: string, since: Date) {
  const base = process.env.CARDBIT_GIVEAWAY_BUYLIST_VERIFY_URL?.trim();
  const secret = process.env.CARDBIT_GIVEAWAY_BUYLIST_VERIFY_SECRET?.trim();
  if (!base || !secret) return null;
  const url = new URL(base);
  url.searchParams.set("email", email);
  url.searchParams.set("since", since.toISOString());
  // Only buylists staff approved count (Trevor 2026-10-27: people sent throwaway buylists for the
  // entries). The buylist app matches approvedAt >= since and skips declined/cancelled ones.
  url.searchParams.set("approved", "1");
  try {
    const res = await fetch(url, {
      headers: { "x-verify-secret": secret, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as {
      submitted?: unknown;
    };
    if (!res.ok || typeof body.submitted !== "boolean") {
      console.warn(`[buylist-verify] check failed: ${res.status}`);
      return null;
    }
    return body.submitted;
  } catch (e) {
    console.warn(`[buylist-verify] check failed: ${String(e)}`);
    return null;
  }
}
