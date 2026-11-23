import { createHmac, timingSafeEqual } from "node:crypto";

// Signed entrant token the storefront widget keeps so returning visitors can
// complete more actions without re-entering their email.

function key() {
  const s = process.env.CARDBIT_GIVEAWAY_ENTRANT_TOKEN_SECRET ?? process.env.SHOPIFY_API_SECRET;
  if (!s)
    throw new Error("ENTRANT_TOKEN_SECRET (or SHOPIFY_API_SECRET) must be set");
  return s;
}

const sign = (payload: string) =>
  createHmac("sha256", key()).update(payload).digest("base64url");

export function issueEntrantToken(entrantId: string, campaignId: string) {
  const payload = `${entrantId}.${campaignId}`;
  return `${payload}.${sign(payload)}`;
}

export function readEntrantToken(token: string | null | undefined) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [entrantId, campaignId, sig] = parts;
  const expected = Buffer.from(sign(`${entrantId}.${campaignId}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  return { entrantId, campaignId };
}
