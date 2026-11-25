// Thin EasyPost REST client (v2), the backup label provider behind the same ShippingProvider
// interface as Shippo. Picked with CARDBIT_LABEL_PROVIDER=easypost; Shippo stays the default.
// Key: EASYPOST_API_KEY (EZTK… test key on the site environment until Trevor approves live postage).
//
// Rates come back with Shippo-style service tokens (usps_ground_advantage, ups_ground, …) so
// pickRate and CARDBIT_SHIP_SERVICES work the same with either provider.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Parcel } from "./policy";
import type { Address, AddressCheck, Label, Rate, ShippingProvider, Tracking, TrackingStatus } from "./shippo.server";

export class EasyPostError extends Error {
  constructor(message: string, public status: number, public body?: unknown) {
    super(message);
    this.name = "EasyPostError";
  }
}

type Fetch = typeof fetch;

export function easypostFromEnv(env: NodeJS.ProcessEnv = process.env, fetcher: Fetch = fetch): EasyPostClient | null {
  const key = env.EASYPOST_API_KEY;
  return key ? new EasyPostClient(key, fetcher) : null;
}

/** EasyPost carrier + service name → the Shippo-style token the rest of shipping uses. */
const SERVICE_TOKENS: Record<string, string> = {
  "usps:groundadvantage": "usps_ground_advantage",
  "usps:priority": "usps_priority",
  "usps:express": "usps_priority_express",
  "usps:first": "usps_first",
  "ups:ground": "ups_ground",
  "ups:groundsaver": "ups_ground_saver",
  "ups:upsgroundsaver": "ups_ground_saver",
  "ups:upssurepost": "ups_ground_saver",
  "ups:3dayselect": "ups_3_day_select",
  "ups:2nddayair": "ups_second_day_air",
  "ups:nextdayair": "ups_next_day_air",
};

export function serviceToken(carrier: string, service: string) {
  const key = `${carrier}:${service}`.toLowerCase().replace(/[^a-z0-9:]/g, "");
  if (SERVICE_TOKENS[key]) return SERVICE_TOKENS[key];
  const snake = service.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").toLowerCase();
  return `${carrier.toLowerCase()}_${snake}`.replace(/_+$/, "");
}

/** Readable service name for the desk and emails ("GroundAdvantage" → "Ground Advantage"). */
function serviceName(service: string) {
  return service.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^Ups\b/i, "UPS");
}

export function trackingStatusFrom(status: string | null | undefined): TrackingStatus {
  switch ((status ?? "").toLowerCase()) {
    case "pre_transit": return "PRE_TRANSIT";
    case "in_transit":
    case "out_for_delivery":
    case "available_for_pickup": return "TRANSIT";
    case "delivered": return "DELIVERED";
    case "return_to_sender": return "RETURNED";
    case "failure":
    case "error":
    case "cancelled": return "FAILURE";
    default: return "UNKNOWN";
  }
}

export function trackingFromTracker(t: EpTracker, carrier: string, trackingNumber: string): Tracking {
  const last = (t.tracking_details ?? []).at(-1);
  return {
    carrier: (t.carrier || carrier).toLowerCase(),
    trackingNumber: t.tracking_code || trackingNumber,
    status: trackingStatusFrom(t.status),
    detail: last?.message || t.status_detail || "",
    at: last?.datetime ?? t.updated_at ?? null,
    eta: t.est_delivery_date ?? null,
  };
}

export class EasyPostClient implements ShippingProvider {
  readonly name = "EasyPost";
  readonly test: boolean;
  constructor(private key: string, private fetcher: Fetch = fetch, private base = "https://api.easypost.com/v2") {
    this.test = !key.startsWith("EZAK");
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await this.fetcher(this.base + path, {
          method,
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.key}:`).toString("base64")}`,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(25_000),
        });
        const text = await res.text();
        const json = text ? safeJson(text) : null;
        if (res.status === 429 || res.status >= 500) {
          lastErr = new EasyPostError(`EasyPost ${res.status}`, res.status, json);
          await sleep(400 * (attempt + 1));
          continue;
        }
        if (!res.ok) throw new EasyPostError(errorText(json) || `EasyPost ${res.status}`, res.status, json);
        return json as T;
      } catch (err) {
        if (err instanceof EasyPostError && err.status < 500 && err.status !== 429) throw err;
        lastErr = err;
        await sleep(400 * (attempt + 1));
      }
    }
    throw lastErr instanceof Error ? lastErr : new EasyPostError("EasyPost unreachable", 0);
  }

  async validateAddress(address: Address): Promise<AddressCheck> {
    const r = await this.call<EpAddress>("POST", "/addresses", { verify: ["delivery"], address: toEpAddress(address) });
    const d = r.verifications?.delivery;
    return {
      valid: Boolean(d?.success),
      address: fromEpAddress(r, address),
      residential: typeof r.residential === "boolean" ? r.residential : null,
      messages: (d?.errors ?? []).map((e) => e.message || e.code || "").filter(Boolean),
    };
  }

  async rates(from: Address, to: Address, parcel: Parcel, metadata: string): Promise<Rate[]> {
    const r = await this.call<EpShipment>("POST", "/shipments", {
      shipment: {
        from_address: toEpAddress(from),
        to_address: toEpAddress(to),
        parcel: { length: parcel.length, width: parcel.width, height: parcel.height, weight: parcel.weightOz },
        reference: metadata.slice(0, 100),
        options: { label_format: "PDF", label_size: "4x6", print_custom_1: metadata.slice(0, 35) },
      },
    });
    return (r.rates ?? [])
      .filter((x) => (x.currency ?? "USD") === "USD")
      .map((x) => ({
        rateId: x.id,
        shipmentId: x.shipment_id || r.id,
        carrier: x.carrier,
        service: serviceName(x.service),
        serviceToken: serviceToken(x.carrier, x.service),
        amountCents: Math.round(Number(x.rate) * 100),
        currency: x.currency ?? "USD",
        days: x.delivery_days ?? x.est_delivery_days ?? null,
        attributes: [],
      }));
  }

  /** EasyPost buys on the shipment, so the caller passes the rate's shipmentId. */
  async buyLabel(rateId: string, _metadata: string, shipmentId?: string): Promise<Label> {
    if (!shipmentId) throw new EasyPostError("EasyPost needs the shipment id to buy a rate.", 400);
    const r = await this.call<EpShipment>("POST", `/shipments/${encodeURIComponent(shipmentId)}/buy`, { rate: { id: rateId } });
    const labelUrl = r.postage_label?.label_pdf_url || r.postage_label?.label_url || null;
    const ok = Boolean(r.tracking_code && labelUrl);
    return {
      transactionId: r.id,
      status: ok ? "SUCCESS" : "ERROR",
      trackingNumber: r.tracking_code || null,
      trackingUrl: r.tracker?.public_url || null,
      labelUrl,
      messages: (r.messages ?? []).map((m) => m.message || "").filter(Boolean),
    };
  }

  /** Reuses the tracker EasyPost made with the label; creates one only for numbers bought elsewhere. */
  async track(carrier: string, trackingNumber: string): Promise<Tracking> {
    const q = new URLSearchParams({ tracking_code: trackingNumber, page_size: "5" });
    const list = await this.call<{ trackers?: EpTracker[] }>("GET", `/trackers?${q}`);
    const found = (list.trackers ?? []).find((t) => t.tracking_code === trackingNumber);
    const t =
      found ??
      (await this.call<EpTracker>("POST", "/trackers", {
        tracker: { tracking_code: trackingNumber, carrier: carrier.toUpperCase() },
      }));
    return trackingFromTracker(t, carrier, trackingNumber);
  }
}

/**
 * EasyPost signs webhooks when the webhook has a secret: X-Hmac-Signature = "hmac-sha256-hex=<hex>"
 * over the raw body. EasyPost's own library also accepts the body with integer weights written
 * as floats ("weight": 10 → 10.0), so we check both forms.
 */
export function easypostSignatureOk(rawBody: string, header: string | null, secret: string) {
  if (!header) return false;
  const key = Buffer.from(secret.normalize("NFKD"), "utf8");
  const bodies = [rawBody, rawBody.replace(/("weight":\s*)(\d+)(\s*)(?=,|\})/g, "$1$2.0")];
  const given = Buffer.from(header, "utf8");
  return bodies.some((b) => {
    const want = Buffer.from(`hmac-sha256-hex=${createHmac("sha256", key).update(b, "utf8").digest("hex")}`, "utf8");
    return want.length === given.length && timingSafeEqual(want, given);
  });
}

// ---- wire types (subset) ----
type EpMessage = { code?: string; message?: string; field?: string };
type EpAddress = {
  name?: string | null; company?: string | null; street1?: string | null; street2?: string | null; city?: string | null;
  state?: string | null; zip?: string | null; country?: string | null; residential?: boolean | null;
  verifications?: { delivery?: { success?: boolean; errors?: EpMessage[] } } | null;
};
type EpRate = {
  id: string; shipment_id?: string; carrier: string; service: string; rate: string; currency?: string;
  delivery_days?: number | null; est_delivery_days?: number | null;
};
type EpShipment = {
  id: string; rates?: EpRate[]; tracking_code?: string | null; messages?: EpMessage[];
  postage_label?: { label_url?: string | null; label_pdf_url?: string | null } | null;
  tracker?: { public_url?: string | null } | null;
};
export type EpTracker = {
  id?: string; tracking_code?: string; carrier?: string; status?: string | null; status_detail?: string | null;
  est_delivery_date?: string | null; updated_at?: string | null; public_url?: string | null;
  tracking_details?: { message?: string; status?: string; datetime?: string }[] | null;
};

function toEpAddress(a: Address) {
  return {
    name: a.name, company: a.company || undefined, street1: a.street1, street2: a.street2 || undefined, city: a.city,
    state: a.state, zip: a.zip, country: a.country, phone: a.phone || undefined, email: a.email || undefined,
  };
}
function fromEpAddress(r: EpAddress, fallback: Address): Address {
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
  const e = (json as { error?: { message?: string; errors?: EpMessage[] } } | null)?.error;
  if (!e) return "";
  const extra = (e.errors ?? []).map((x) => [x.field, x.message].filter(Boolean).join(": ")).filter(Boolean);
  return [e.message, ...extra].filter(Boolean).join("; ").slice(0, 300);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
