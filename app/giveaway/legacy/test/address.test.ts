import { describe, expect, it } from "vitest";
import { countryCode, provinceCode, splitName } from "../app/lib/address";

describe("claim form address codes", () => {
  it("reads common ways of writing the country", () => {
    expect(countryCode("United States")).toBe("US");
    expect(countryCode(" U.S.A. ")).toBe("US");
    expect(countryCode("us")).toBe("US");
    expect(countryCode("Canada")).toBe("CA");
    expect(countryCode("DE")).toBe("DE");
    expect(countryCode("Narnia")).toBeNull();
  });

  it("reads US states and Canadian provinces by name or code", () => {
    expect(provinceCode("Texas", "US")).toBe("TX");
    expect(provinceCode("new york", "US")).toBe("NY");
    expect(provinceCode("ca", "US")).toBe("CA");
    expect(provinceCode("Ontario", "CA")).toBe("ON");
    expect(provinceCode("Bavaria", "DE")).toBeNull();
    expect(provinceCode("", "US")).toBeNull();
    expect(provinceCode("Atlantis", "US")).toBeNull();
  });

  it("splits a full name into first and last", () => {
    expect(splitName("Ash  Ketchum Jr")).toEqual({
      firstName: "Ash",
      lastName: "Ketchum Jr",
    });
  });
});
