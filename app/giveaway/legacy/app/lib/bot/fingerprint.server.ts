import { createHmac } from "node:crypto";

// Network and device identifiers are stored only as keyed hashes, so raw IPs
// never sit in the database but repeat visitors can still be matched.

function secret() {
  const s = process.env.CARDBIT_GIVEAWAY_FINGERPRINT_SECRET;
  if (!s && process.env.NODE_ENV === "production") {
    throw new Error("FINGERPRINT_SECRET must be set in production");
  }
  return s ?? "dev-only-fingerprint-secret";
}

export function hashId(value: string) {
  return createHmac("sha256", secret())
    .update(value)
    .digest("hex")
    .slice(0, 32);
}

/** /24 for IPv4, /48 for IPv6. */
export function subnetOf(ip: string) {
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":") + "::/48";
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts.slice(0, 3).join(".")}.0/24` : ip;
}

export function clientIp(request: Request) {
  // Cloudflare sits in front in production; fall back to the proxy chain.
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "0.0.0.0"
  );
}
