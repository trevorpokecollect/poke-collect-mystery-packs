// Where Cardbit may sell and ship. One check, used by top-ups, pack purchases and shipping.
// Published policy: US only, never AL, HI, ID, MN, NV, NY, UT or WA. The billing address, the
// delivery address (when there is one) and the request IP must all pass, checked on the server.

export const EXCLUDED_STATES = ["AL", "HI", "ID", "MN", "NV", "NY", "UT", "WA"] as const;

export const US_STATES = new Set([
  "AK", "AL", "AR", "AZ", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "IA", "ID", "IL", "IN",
  "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ",
  "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA",
  "WI", "WV", "WY",
]);

export type RegionAction = "topup" | "pack_purchase" | "shipping";

export type GeoResult = { country: string; region?: string | null } | null;

/** IP → country/state. Return null when unknown. Injected so tests and providers can swap. */
export type GeoLookup = (ip: string) => Promise<GeoResult>;

export class RegionBlocked extends Error {
  constructor(
    public code: "NOT_US" | "EXCLUDED_STATE" | "UNKNOWN_STATE" | "IP_NOT_US" | "IP_EXCLUDED_STATE",
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
    const body = (await res.json()) as { country?: string; region?: string };
    const value: GeoResult = body.country
      ? { country: body.country, region: body.country === "US" ? stateCode(body.region) : null }
      : null;
    cache.set(ip, { at: Date.now(), value });
    return value;
  };
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
