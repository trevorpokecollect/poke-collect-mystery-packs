import { describe, expect, it } from "vitest";
import { adPixels, adsTag } from "./shell.server";

describe("ad pixels", () => {
  it("stays out of pages until a pixel ID is set, and ignores malformed IDs", () => {
    expect(adsTag({} as NodeJS.ProcessEnv)).toBe("");
    expect(adsTag({ CARDBIT_SITE_META_PIXEL_ID: "<script>" } as unknown as NodeJS.ProcessEnv)).toBe("");
    const env = { CARDBIT_SITE_META_PIXEL_ID: " 123456789012345 ", CARDBIT_SITE_TIKTOK_PIXEL_ID: "C4ABCDEFGHIJ12345678", CARDBIT_SITE_GOOGLE_ADS_ID: "AW-1234567890", CARDBIT_SITE_GOOGLE_ADS_PURCHASE_LABEL: "abC_d-12", CARDBIT_SITE_GOOGLE_ADS_LEAD_LABEL: "_2GKlead-9" } as unknown as NodeJS.ProcessEnv;
    expect(adPixels(env)).toEqual({ meta: "123456789012345", tiktok: "C4ABCDEFGHIJ12345678", gads: "AW-1234567890", gadsPurchase: "abC_d-12", gadsLead: "_2GKlead-9" });
    const tag = adsTag(env);
    expect(tag).toContain('src="/site/js/cardbit-site-ads.js?v=');
    expect(tag).toContain('data-meta="123456789012345"');
    expect(tag).toContain('data-gads="AW-1234567890"');
    expect(tag).toContain('data-gads-lead="_2GKlead-9"');
    expect(adPixels({ CARDBIT_SITE_GOOGLE_ADS_ID: "G-ABC" } as unknown as NodeJS.ProcessEnv).gads).toBe("");
  });
});
