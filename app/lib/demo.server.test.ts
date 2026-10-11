import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoToken, validDemoToken } from "./demo.server";

describe("demo preview tokens", () => {
  const previous = process.env.SHOPIFY_API_SECRET;
  beforeAll(() => { process.env.SHOPIFY_API_SECRET = "test-secret"; });
  afterAll(() => { process.env.SHOPIFY_API_SECRET = previous; });

  it("accepts a fresh token for the same shop", () => {
    expect(validDemoToken("a.myshopify.com", demoToken("a.myshopify.com"))).toBe(true);
  });
  it("rejects other shops, tampering, expiry and junk", () => {
    const token = demoToken("a.myshopify.com", 1);
    expect(validDemoToken("b.myshopify.com", token)).toBe(false);
    expect(validDemoToken("a.myshopify.com", token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"))).toBe(false);
    expect(validDemoToken("a.myshopify.com", token, Date.now() + 2 * 86400000)).toBe(false);
    expect(validDemoToken("a.myshopify.com", "1")).toBe(false);
    expect(validDemoToken("a.myshopify.com", null)).toBe(false);
  });
});
