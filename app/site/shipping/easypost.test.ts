import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EasyPostClient, easypostSignatureOk, serviceToken, trackingStatusFrom } from "./easypost.server";
import { pickRate } from "./service.server";
import { labelProviderFromEnv, labelProviderName } from "./wire.server";

type Call = { method: string; url: string; body: unknown; auth: string | null };

function fakeFetch(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    const path = new URL(url).pathname + new URL(url).search;
    calls.push({
      method,
      url: path,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      auth: new Headers(init.headers).get("authorization"),
    });
    const key = Object.keys(routes).find((k) => `${method} ${path}`.startsWith(k));
    if (!key) return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
    const v = routes[key];
    if (v instanceof Response) return v;
    return new Response(JSON.stringify(v), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const from = { name: "Cardbit", street1: "181 Hughes Rd", street2: "Ste 5", city: "Madison", state: "AL", zip: "35758", country: "US", phone: "2562000050" };
const to = { name: "Ash", street1: "1 Main St", city: "Austin", state: "TX", zip: "78701", country: "US" };
const parcel = { length: 9, width: 6, height: 1, weightOz: 2, template: "mailer-small" };

describe("EasyPost provider", () => {
  it("uses Basic auth, knows test vs live keys", () => {
    expect(new EasyPostClient("EZTKabc").test).toBe(true);
    expect(new EasyPostClient("EZAKabc").test).toBe(false);
  });

  it("validates addresses with delivery verification", async () => {
    const { fetcher, calls } = fakeFetch({
      "POST /v2/addresses": {
        street1: "1 MAIN ST", city: "AUSTIN", state: "tx", zip: "78701-0001", country: "US", residential: true,
        verifications: { delivery: { success: false, errors: [{ code: "E.ADDRESS.NOT_FOUND", message: "Address not found" }] } },
      },
    });
    const check = await new EasyPostClient("EZTKkey", fetcher).validateAddress(to);
    expect(calls[0].auth).toBe(`Basic ${Buffer.from("EZTKkey:").toString("base64")}`);
    expect(calls[0].body).toMatchObject({ verify: ["delivery"], address: { street1: "1 Main St", state: "TX" } });
    expect(check).toMatchObject({ valid: false, residential: true, messages: ["Address not found"] });
    expect(check.address).toMatchObject({ street1: "1 MAIN ST", state: "TX", zip: "78701-0001", name: "Ash" });
  });

  it("maps rates to Shippo-style tokens so pickRate keeps working", async () => {
    const { fetcher, calls } = fakeFetch({
      "POST /v2/shipments": {
        id: "shp_1",
        rates: [
          { id: "rate_p", shipment_id: "shp_1", carrier: "USPS", service: "Priority", rate: "9.10", currency: "USD", delivery_days: 2 },
          { id: "rate_g", shipment_id: "shp_1", carrier: "USPS", service: "GroundAdvantage", rate: "5.59", currency: "USD", delivery_days: 4 },
          { id: "rate_u", shipment_id: "shp_1", carrier: "UPS", service: "Ground", rate: "11.20", currency: "USD" },
        ],
      },
    });
    const rates = await new EasyPostClient("EZTKkey", fetcher).rates(from, to, parcel, "shipment-1");
    expect(calls[0].body).toMatchObject({
      shipment: { parcel: { weight: 2 }, reference: "shipment-1", options: { label_format: "PDF", label_size: "4x6" } },
    });
    expect(rates.map((r) => r.serviceToken)).toEqual(["usps_priority", "usps_ground_advantage", "ups_ground"]);
    const pick = pickRate(rates);
    expect(pick).toMatchObject({ rateId: "rate_g", shipmentId: "shp_1", service: "Ground Advantage", amountCents: 559, days: 4 });
  });

  it("buys on the shipment and returns the PDF label + tracker link", async () => {
    const { fetcher, calls } = fakeFetch({
      "POST /v2/shipments/shp_1/buy": {
        id: "shp_1", tracking_code: "9400111",
        postage_label: { label_url: "https://ep/label.png", label_pdf_url: "https://ep/label.pdf" },
        tracker: { public_url: "https://track.easypost.com/x" },
      },
    });
    const ep = new EasyPostClient("EZTKkey", fetcher);
    const label = await ep.buyLabel("rate_g", "s1", "shp_1");
    expect(calls[0].body).toEqual({ rate: { id: "rate_g" } });
    expect(label).toMatchObject({ status: "SUCCESS", transactionId: "shp_1", trackingNumber: "9400111", labelUrl: "https://ep/label.pdf", trackingUrl: "https://track.easypost.com/x" });
    await expect(ep.buyLabel("rate_g", "s1")).rejects.toThrow(/shipment id/);
  });

  it("reuses the label's tracker, creating one only when none exists", async () => {
    const tracker = {
      tracking_code: "9400111", carrier: "USPS", status: "in_transit", est_delivery_date: "2026-11-30",
      tracking_details: [{ message: "Accepted", datetime: "2026-11-26T15:00:00Z" }, { message: "Departed", datetime: "2026-11-27T02:00:00Z" }],
    };
    const found = fakeFetch({ "GET /v2/trackers?": { trackers: [tracker] } });
    const t = await new EasyPostClient("EZTKkey", found.fetcher).track("usps", "9400111");
    expect(found.calls).toHaveLength(1);
    expect(t).toEqual({ carrier: "usps", trackingNumber: "9400111", status: "TRANSIT", detail: "Departed", at: "2026-11-27T02:00:00Z", eta: "2026-11-30" });

    const fresh = fakeFetch({ "GET /v2/trackers?": { trackers: [] }, "POST /v2/trackers": { ...tracker, status: "delivered" } });
    const t2 = await new EasyPostClient("EZTKkey", fresh.fetcher).track("usps", "9400111");
    expect(fresh.calls[1].body).toEqual({ tracker: { tracking_code: "9400111", carrier: "USPS" } });
    expect(t2.status).toBe("DELIVERED");
  });

  it("surfaces EasyPost error messages and doesn't retry 4xx", async () => {
    const { fetcher, calls } = fakeFetch({
      "POST /v2/shipments": new Response(JSON.stringify({ error: { message: "Invalid parcel", errors: [{ field: "weight", message: "must be > 0" }] } }), { status: 422 }),
    });
    await expect(new EasyPostClient("EZTKkey", fetcher).rates(from, to, parcel, "x")).rejects.toThrow("Invalid parcel; weight: must be > 0");
    expect(calls).toHaveLength(1);
  });

  it("maps statuses and service names", () => {
    expect(trackingStatusFrom("out_for_delivery")).toBe("TRANSIT");
    expect(trackingStatusFrom("return_to_sender")).toBe("RETURNED");
    expect(trackingStatusFrom("cancelled")).toBe("FAILURE");
    expect(trackingStatusFrom("pre_transit")).toBe("PRE_TRANSIT");
    expect(trackingStatusFrom(undefined)).toBe("UNKNOWN");
    expect(serviceToken("UPS", "UPSGroundsaver")).toBe("ups_ground_saver");
    expect(serviceToken("USPS", "Express")).toBe("usps_priority_express");
    expect(serviceToken("FedEx", "FEDEX_GROUND")).toBe("fedex_fedex_ground");
  });

  it("checks webhook HMAC signatures (incl. EasyPost's float-weight form)", () => {
    const secret = "s3cret";
    const raw = '{"description":"tracker.updated","result":{"weight":10}}';
    const sign = (b: string) => `hmac-sha256-hex=${createHmac("sha256", secret).update(b).digest("hex")}`;
    expect(easypostSignatureOk(raw, sign(raw), secret)).toBe(true);
    expect(easypostSignatureOk(raw, sign(raw.replace('"weight":10', '"weight":10.0')), secret)).toBe(true);
    expect(easypostSignatureOk(raw, sign(raw + " "), secret)).toBe(false);
    expect(easypostSignatureOk(raw, null, secret)).toBe(false);
  });
});

describe("label provider switch", () => {
  it("defaults to Shippo; CARDBIT_LABEL_PROVIDER=easypost picks EasyPost", () => {
    expect(labelProviderName({})).toBe("shippo");
    expect(labelProviderName({ CARDBIT_LABEL_PROVIDER: " EasyPost " })).toBe("easypost");
    expect(labelProviderName({ CARDBIT_LABEL_PROVIDER: "pirateship" })).toBe("shippo");
    expect(labelProviderFromEnv({ SHIPPO_API_TOKEN: "shippo_test_x", EASYPOST_API_KEY: "EZTKx" })?.name).toBe("Shippo");
    expect(labelProviderFromEnv({ CARDBIT_LABEL_PROVIDER: "easypost", SHIPPO_API_TOKEN: "shippo_test_x", EASYPOST_API_KEY: "EZTKx" })?.name).toBe("EasyPost");
    // No silent fallback: picking EasyPost without its key leaves labels off.
    expect(labelProviderFromEnv({ CARDBIT_LABEL_PROVIDER: "easypost", SHIPPO_API_TOKEN: "shippo_test_x" })).toBeNull();
    // Webhooks force their own provider regardless of the switch.
    expect(labelProviderFromEnv({ SHIPPO_API_TOKEN: "shippo_test_x", EASYPOST_API_KEY: "EZTKx" }, "easypost")?.name).toBe("EasyPost");
  });
});
