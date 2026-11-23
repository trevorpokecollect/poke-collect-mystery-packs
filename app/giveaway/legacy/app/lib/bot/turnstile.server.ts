// Server-side verification of Cloudflare Turnstile tokens.
// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  success: boolean;
  errorCodes: string[];
}

export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  const secret = process.env.CARDBIT_GIVEAWAY_TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Allow local development without keys; never in production.
    if (process.env.NODE_ENV !== "production")
      return { success: true, errorCodes: ["dev-bypass"] };
    return { success: false, errorCodes: ["missing-secret"] };
  }
  if (!token) return { success: false, errorCodes: ["missing-input-response"] };

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  try {
    const res = await fetchImpl(VERIFY_URL, { method: "POST", body });
    const json = (await res.json()) as {
      success: boolean;
      "error-codes"?: string[];
    };
    return { success: !!json.success, errorCodes: json["error-codes"] ?? [] };
  } catch {
    return { success: false, errorCodes: ["network-error"] };
  }
}
