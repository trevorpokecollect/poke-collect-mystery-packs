// Thin Shippo REST client (API version 2018-02-08). Only what vault shipping needs.
// Token: SHIPPO_API_TOKEN (shippo_test_… on the site environment until Trevor approves live postage).

import type { Parcel } from "./policy";

export type Address = {
  name: string;
  company?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
};

export type AddressCheck = {
  valid: boolean;
  /** Carrier-normalized address to store and ship to when valid. */
  address: Address;
  residential: boolean | null;
  messages: string[];
};

export type Rate = {
  rateId: string;
  shipmentId: string;
  carrier: string;
  service: string;
  serviceToken: string;
  amountCents: number;
  currency: string;
  days: number | null;
  attributes: string[];
};

export type Label = {
  transactionId: string;
  status: "SUCCESS" | "QUEUED" | "WAITING" | "ERROR";
  trackingNumber: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  messages: string[];
};

export type TrackingStatus = "UNKNOWN" | "PRE_TRANSIT" | "TRANSIT" | "DELIVERED" | "RETURNED" | "FAILURE";

export type Tracking = {
  carrier: string;
  trackingNumber: string;
  status: TrackingStatus;
  detail: string;
  at: string | null;
  eta: string | null;
};

/** Everything the shipping service needs from a label provider. Faked in tests. */
export interface ShippingProvider {
  /** Shown on the staff desk ("Shippo", "EasyPost"). */
  readonly name?: string;
  /** True for test keys: labels are free samples that can't be mailed. */
  readonly test?: boolean;
  validateAddress(address: Address): Promise<AddressCheck>;
  rates(from: Address, to: Address, parcel: Parcel, metadata: string): Promise<Rate[]>;
  /** shipmentId is the Rate's shipmentId (EasyPost buys on the shipment; Shippo ignores it). */
  buyLabel(rateId: string, metadata: string, shipmentId?: string): Promise<Label>;
  track(carrier: string, trackingNumber: string): Promise<Tracking>;
  /** Asks Shippo to send track_updated webhooks for a number bought elsewhere (labels we buy are auto-registered). */
  registerTracking?(carrier: string, trackingNumber: string, metadata: string): Promise<void>;
}

export class ShippoError extends Error {
  constructor(message: string, public status: number, public body?: unknown) {
    super(message);
    this.name = "ShippoError";
  }
}

type Fetch = typeof fetch;

export function shippoFromEnv(env: NodeJS.ProcessEnv = process.env, fetcher: Fetch = fetch): ShippoClient | null {
  const token = env.SHIPPO_API_TOKEN;
  return token ? new ShippoClient(token, fetcher) : null;
}

export class ShippoClient implements ShippingProvider {
  readonly name = "Shippo";
  readonly test: boolean;
  constructor(private token: string, private fetcher: Fetch = fetch, private base = "https://api.goshippo.com") {
    this.test = token.startsWith("shippo_test_");
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await this.fetcher(this.base + path, {
          method,
          headers: {
            Authorization: `ShippoToken ${this.token}`,
            "Content-Type": "application/json",
            "SHIPPO-API-VERSION": "2018-02-08",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(20_000),
        });
        const text = await res.text();
        const json = text ? safeJson(text) : null;
        if (res.status === 429 || res.status >= 500) {
          lastErr = new ShippoError(`Shippo ${res.status}`, res.status, json);
          await sleep(400 * (attempt + 1));
          continue;
        }
        if (!res.ok) throw new ShippoError(errorText(json) || `Shippo ${res.status}`, res.status, json);
        return json as T;
      } catch (err) {
        if (err instanceof ShippoError && err.status < 500 && err.status !== 429) throw err;
        lastErr = err;
        await sleep(400 * (attempt + 1));
      }
    }
    throw lastErr instanceof Error ? lastErr : new ShippoError("Shippo unreachable", 0);
  }

  async validateAddress(address: Address): Promise<AddressCheck> {
    const r = await this.call<ShippoAddress>("POST", "/addresses/", { ...toShippoAddress(address), validate: true });
    const v = r.validation_results ?? {};
    return {
      valid: Boolean(v.is_valid),
      address: fromShippoAddress(r, address),
      residential: typeof r.is_residential === "boolean" ? r.is_residential : null,
      messages: (v.messages ?? []).map((m) => m.text || m.code || "").filter(Boolean),
    };
  }

  async rates(from: Address, to: Address, parcel: Parcel, metadata: string): Promise<Rate[]> {
    const r = await this.call<ShippoShipment>("POST", "/shipments/", {
      address_from: toShippoAddress(from),
      address_to: toShippoAddress(to),
      parcels: [
        {
          length: String(parcel.length),
          width: String(parcel.width),
          height: String(parcel.height),
          distance_unit: "in",
          weight: String(parcel.weightOz),
          mass_unit: "oz",
        },
      ],
      metadata: metadata.slice(0, 100),
      async: false,
    });
    return (r.rates ?? [])
      .filter((x) => x.currency === "USD")
      .map((x) => ({
        rateId: x.object_id,
        shipmentId: r.object_id,
        carrier: x.provider,
        service: x.servicelevel?.name ?? "",
        serviceToken: x.servicelevel?.token ?? "",
        amountCents: Math.round(Number(x.amount) * 100),
        currency: x.currency,
        days: x.estimated_days ?? x.days ?? null,
        attributes: x.attributes ?? [],
      }));
  }

  async buyLabel(rateId: string, metadata: string): Promise<Label> {
    const r = await this.call<ShippoTransaction>("POST", "/transactions/", {
      rate: rateId,
      label_file_type: "PDF_4x6",
      metadata: metadata.slice(0, 100),
      async: false,
    });
    return {
      transactionId: r.object_id,
      status: r.status,
      trackingNumber: r.tracking_number || null,
      trackingUrl: r.tracking_url_provider || null,
      labelUrl: r.label_url || null,
      messages: (r.messages ?? []).map((m) => m.text || "").filter(Boolean),
    };
  }

  async track(carrier: string, trackingNumber: string): Promise<Tracking> {
    const r = await this.call<ShippoTrack>(
      "GET",
      `/tracks/${encodeURIComponent(carrier)}/${encodeURIComponent(trackingNumber)}`,
    );
    return trackingFrom(r, carrier, trackingNumber);
  }

  async registerTracking(carrier: string, trackingNumber: string, metadata: string) {
    await this.call("POST", "/tracks/", { carrier, tracking_number: trackingNumber, metadata: metadata.slice(0, 100) });
  }
}

export function trackingFrom(r: ShippoTrack, carrier: string, trackingNumber: string): Tracking {
  const s = r.tracking_status;
  const status = (s?.status ?? "UNKNOWN") as TrackingStatus;
  return {
    carrier: r.carrier || carrier,
    trackingNumber: r.tracking_number || trackingNumber,
    status: ["UNKNOWN", "PRE_TRANSIT", "TRANSIT", "DELIVERED", "RETURNED", "FAILURE"].includes(status)
      ? status
      : "UNKNOWN",
    detail: s?.status_details ?? "",
    at: s?.status_date ?? null,
    eta: r.eta ?? null,
  };
}

// ---- wire types (subset) ----
type ShippoMessage = { code?: string; text?: string };
type ShippoAddress = {
  name?: string; company?: string; street1?: string; street2?: string; city?: string; state?: string;
  zip?: string; country?: string; phone?: string; email?: string; is_residential?: boolean | null;
  validation_results?: { is_valid?: boolean; messages?: ShippoMessage[] };
};
type ShippoRate = {
  object_id: string; amount: string; currency: string; provider: string;
  servicelevel?: { name?: string; token?: string }; estimated_days?: number; days?: number; attributes?: string[];
};
type ShippoShipment = { object_id: string; rates?: ShippoRate[] };
type ShippoTransaction = {
  object_id: string; status: Label["status"]; tracking_number?: string; tracking_url_provider?: string;
  label_url?: string; messages?: ShippoMessage[];
};
export type ShippoTrack = {
  carrier?: string; tracking_number?: string; eta?: string | null; metadata?: string | null;
  tracking_status?: { status?: string; status_details?: string; status_date?: string } | null;
};

function toShippoAddress(a: Address) {
  return {
    name: a.name, company: a.company ?? "", street1: a.street1, street2: a.street2 ?? "", city: a.city,
    state: a.state, zip: a.zip, country: a.country, phone: a.phone ?? "", email: a.email ?? "",
  };
}
function fromShippoAddress(r: ShippoAddress, fallback: Address): Address {
  return {
    name: r.name || fallback.name,
    company: r.company || fallback.company,
    street1: r.street1 || fallback.street1,
    street2: r.street2 || fallback.street2,
    city: r.city || fallback.city,
    state: (r.state || fallback.state).toUpperCase(),
    zip: r.zip || fallback.zip,
    country: (r.country || fallback.country).toUpperCase(),
    phone: fallback.phone,
    email: fallback.email,
  };
}
function safeJson(t: string) {
  try { return JSON.parse(t); } catch { return { raw: t.slice(0, 500) }; }
}
function errorText(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const j = json as Record<string, unknown>;
  if (typeof j.detail === "string") return j.detail;
  const parts = Object.entries(j).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : String(v)}`);
  return parts.join("; ").slice(0, 300);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
