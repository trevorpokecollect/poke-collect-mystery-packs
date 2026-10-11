import { createHmac, timingSafeEqual } from "node:crypto";

// Preview links for My Packs (/apps/packs?demo=<token>): sample packs and pulls from the live
// pool so the merchant can check the page and the opening animation without buying a pack.
// The token is signed with the app secret and expires, so customers can't stumble into it.

const DAY = 24 * 60 * 60 * 1000;

function sign(shop: string, expires: number) {
  return createHmac("sha256", process.env.SHOPIFY_API_SECRET || "")
    .update(`${shop}.${expires}`)
    .digest("base64url")
    .slice(0, 22);
}

export function demoToken(shop: string, days = 30, now = Date.now()) {
  const expires = Math.floor((now + days * DAY) / 1000);
  return `${expires}.${sign(shop, expires)}`;
}

export function validDemoToken(shop: string, token: string | null | undefined, now = Date.now()) {
  const [exp, sig] = String(token || "").split(".");
  const expires = Number(exp);
  if (!shop || !sig || !Number.isInteger(expires) || expires * 1000 < now) return false;
  const expected = Buffer.from(sign(shop, expires));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
