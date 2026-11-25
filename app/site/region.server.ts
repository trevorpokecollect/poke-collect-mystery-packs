// Where Cardbit may sell and ship. One check, used by top-ups, pack purchases and shipping.
// Published policy: US only, never AL, HI, ID, MN, NV, NY, UT or WA. The billing address, the
// delivery address (when there is one) and the request IP must all pass, checked on the server.

import { staffEmails } from "./shipping/staff.server";

export const EXCLUDED_STATES = ["AL", "HI", "ID", "MN", "NV", "NY", "UT", "WA"] as const;

export const US_STATES = new Set([
  "AK", "AL", "AR", "AZ", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "IA", "ID", "IL", "IN",
  "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ",
  "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA",
  "WI", "WV", "WY",
]);

export type RegionAction = "topup" | "pack_purchase" | "shipping";

/** anonymous: the connection is a VPN, proxy or Tor exit (ipinfo is_anonymous / privacy flags). */
export type GeoResult = { country: string; region?: string | null; anonymous?: boolean } | null;

/** IP → country/state. Return null when unknown. Injected so tests and providers can swap. */
export type GeoLookup = (ip: string) => Promise<GeoResult>;

export class RegionBlocked extends Error {
  constructor(
    public code: "NOT_US" | "EXCLUDED_STATE" | "UNKNOWN_STATE" | "IP_NOT_US" | "IP_EXCLUDED_STATE" | "IP_ANONYMOUS",
    public source: "billing" | "shipping" | "ip",
    message: string,
  ) {
    super(message);
    this.name = "RegionBlocked";
  }
}

export type RegionInput = {
  action: RegionAction;
  billing?: { country?: string | null; state?: string | null } | null;
  shipping?: { country?: string | null; state?: string | null } | null;
  ip?: string | null;
};

/** The carrier placed the ZIP code in a different state from the one typed. */
export function zipStateMismatch(typed: string, carrier: string) {
  return new RegionBlocked("UNKNOWN_STATE", "shipping", `That ZIP code is in ${carrier}, not ${typed}. Check the state and ZIP code.`);
}

export type RegionResult = { ipChecked: boolean; ipRegion: string | null };

const norm = (v?: string | null) => (v ?? "").trim().toUpperCase();

const customerMessage =
  "Cardbit isn't available in your state yet. We can only sell and ship to US addresses outside AL, HI, ID, MN, NV, NY, UT and WA.";

function checkAddress(source: "billing" | "shipping", addr: { country?: string | null; state?: string | null }) {
  const country = norm(addr.country);
  const state = norm(addr.state);
  if (country !== "US") throw new RegionBlocked("NOT_US", source, customerMessage);
  if (!US_STATES.has(state)) throw new RegionBlocked("UNKNOWN_STATE", source, "Enter a valid US state.");
  if ((EXCLUDED_STATES as readonly string[]).includes(state))
    throw new RegionBlocked("EXCLUDED_STATE", source, customerMessage);
}

/**
 * Throws RegionBlocked unless every supplied location is allowed.
 * Billing is required for every action; shipping is required for "shipping".
 * IP: checked when a lookup is configured. A lookup that knows the country but not the state
 * still blocks non-US IPs. A lookup failure or unknown IP does not block (addresses still must pass);
 * callers get ipChecked=false so the fraud guard can log it.
 * Top-ups (and Club, which uses "topup") also refuse VPN, proxy and Tor connections (Trevor 2026-11-25),
 * because a VPN shows its own state instead of the customer's.
 */
export async function assertAllowedRegion(input: RegionInput, geo?: GeoLookup | null): Promise<RegionResult> {
  if (!input.billing) throw new RegionBlocked("UNKNOWN_STATE", "billing", "Enter your billing address.");
  checkAddress("billing", input.billing);
  if (input.action === "shipping") {
    if (!input.shipping) throw new RegionBlocked("UNKNOWN_STATE", "shipping", "Enter the delivery address.");
    checkAddress("shipping", input.shipping);
  } else if (input.shipping) {
    checkAddress("shipping", input.shipping);
  }

  const ip = (input.ip ?? "").trim();
  if (!geo || !ip || isPrivateIp(ip)) return { ipChecked: false, ipRegion: null };
  let found: GeoResult = null;
  try {
    found = await geo(ip);
  } catch {
    return { ipChecked: false, ipRegion: null };
  }
  if (!found || !found.country) return { ipChecked: false, ipRegion: null };
  if (input.action === "topup" && found.anonymous)
    throw new RegionBlocked(
      "IP_ANONYMOUS",
      "ip",
      "It looks like you're using a VPN or proxy. Turn it off and try again, so we can confirm you're in a state where Cardbit is available.",
    );
  if (norm(found.country) !== "US") throw new RegionBlocked("IP_NOT_US", "ip", customerMessage);
  const region = norm(found.region);
  if ((EXCLUDED_STATES as readonly string[]).includes(region))
    throw new RegionBlocked(
      "IP_EXCLUDED_STATE",
      "ip",
      `Your internet connection looks like it's in ${region}, where Cardbit isn't available yet. We can only sell and ship to customers outside AL, HI, ID, MN, NV, NY, UT and WA.`,
    );
  return { ipChecked: true, ipRegion: region || null };
}

export function isPrivateIp(ip: string) {
  return (
    ip === "::1" ||
    ip.startsWith("127.") ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    ip.startsWith("fe80")
  );
}

/** First public client IP. Railway's edge sets X-Forwarded-For; the left-most entry is the client. */
export function clientIp(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip");
}

/**
 * Default lookup: ipinfo.io when CARDBIT_SITE_IPINFO_TOKEN is set, otherwise none (IP not checked).
 * Results are cached in memory for an hour.
 */
const cache = new Map<string, { at: number; value: GeoResult }>();
export function defaultGeoLookup(env: NodeJS.ProcessEnv = process.env): GeoLookup | null {
  const token = env.CARDBIT_SITE_IPINFO_TOKEN;
  if (!token) return null;
  return async (ip) => {
    const hit = cache.get(ip);
    if (hit && Date.now() - hit.at < 3_600_000) return hit.value;
    const res = await fetch(`https://ipinfo.io/${encodeURIComponent(ip)}?token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as IpinfoBody;
    const value: GeoResult = body.country
      ? { country: body.country, region: body.country === "US" ? stateCode(body.region) : null, anonymous: isAnonymous(body) }
      : null;
    cache.set(ip, { at: Date.now(), value });
    return value;
  };
}

type IpinfoBody = {
  country?: string;
  region?: string;
  is_anonymous?: boolean;
  privacy?: { vpn?: boolean; proxy?: boolean; tor?: boolean };
  anonymous?: { is_vpn?: boolean; is_proxy?: boolean; is_tor?: boolean };
};

/**
 * VPN, proxy or Tor. Core plan sends only is_anonymous; Plus/Max (and the privacy add-on) say which
 * kind, and then iCloud Private Relay alone (which keeps the customer's real region) is not counted.
 */
export function isAnonymous(b: IpinfoBody): boolean {
  const detail = b.anonymous ?? (b.privacy ? { is_vpn: b.privacy.vpn, is_proxy: b.privacy.proxy, is_tor: b.privacy.tor } : null);
  if (detail) return Boolean(detail.is_vpn || detail.is_proxy || detail.is_tor);
  return b.is_anonymous === true;
}

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", "washington, d.c.": "DC", florida: "FL",
  georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
export function stateCode(name?: string | null): string | null {
  if (!name) return null;
  const n = name.trim();
  if (/^[A-Za-z]{2}$/.test(n)) return n.toUpperCase();
  return STATE_NAMES[n.toLowerCase()] ?? null;
}

/**
 * The IP lookup for a paid action by this customer. Staff test accounts (SITE_STAFF_EMAILS) skip only
 * the connection check, so the team can test from the Madison, AL office; billing and delivery
 * addresses are still checked for everyone.
 */
export function geoLookupFor(email: string | null | undefined, env: NodeJS.ProcessEnv = process.env): GeoLookup | null {
  if (email && staffEmails(env).has(email.trim().toLowerCase())) return null;
  return defaultGeoLookup(env);
}
