import { describe, expect, it } from "vitest";
import { sparkPrice, sparksForOpening } from "./cardbit-sparks";

describe("Sparks", () => {
  it("awards 5% of the gap between Cardbits paid and pulled value", () => {
    expect(sparksForOpening(1000, 300)).toBe(35);
    expect(sparksForOpening(1000, 1000)).toBe(0);
    expect(sparksForOpening(1000, 5000)).toBe(0);
    expect(sparksForOpening(1299, 0)).toBe(64);
    expect(sparksForOpening(1000, -50)).toBe(50);
    expect(sparksForOpening(10.5, 0)).toBe(0);
  });
  it("prices cheap singles in three tiers and excludes pricier cards", () => {
    expect(sparkPrice(25)?.sparks).toBe(250);
    expect(sparkPrice(50)?.sparks).toBe(250);
    expect(sparkPrice(51)?.sparks).toBe(500);
    expect(sparkPrice(200)?.sparks).toBe(1000);
    expect(sparkPrice(201)).toBeNull();
    expect(sparkPrice(0)).toBeNull();
  });
});
