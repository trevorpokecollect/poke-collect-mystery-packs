import { describe, expect, it } from "vitest";
import { CARDBIT_SHOP as shop } from "./cardbit.server";
import { featureOn, flagMode, isQaCustomer } from "./cardbit-flags.server";
import { levelsEnabled, engagementFlags } from "./cardbit-levels.server";
import { sparksEnabled } from "./cardbit-sparks.server";
import { spinnerEnabled } from "./cardbit-spinner.server";
import { leaderboardEnabled } from "./cardbit-leaderboard.server";

const base = { CARDBIT_STOREFRONT_SHOP: shop, CARDBIT_QA_CUSTOMERS: " gid://shopify/Customer/11 ,22" } as NodeJS.ProcessEnv;
const qa = "gid://shopify/Customer/11";
const qa2 = "gid://shopify/Customer/22";
const other = "gid://shopify/Customer/33";

describe("engagement switches", () => {
  it("unset or unknown values are off for everyone", () => {
    for (const v of [undefined, "", "off", "true", "QA"]) {
      const env = { ...base, CARDBIT_LEVELS: v };
      expect(featureOn("CARDBIT_LEVELS", shop, qa, env)).toBe(false);
      expect(flagMode("CARDBIT_LEVELS", env)).toBe("off");
    }
  });
  it('"on" opens to everyone, signed out included', () => {
    const env = { ...base, CARDBIT_LEVELS: "on" };
    expect(levelsEnabled(shop, other, env)).toBe(true);
    expect(levelsEnabled(shop, undefined, env)).toBe(true);
  });
  it('"qa" opens only to listed customers (gid or numeric), never to signed-out visitors', () => {
    const env = { ...base, CARDBIT_LEVELS: "qa", CARDBIT_SPARKS: "qa", CARDBIT_SPINNER: "qa", CARDBIT_LEADERBOARD: "qa" };
    for (const fn of [levelsEnabled, sparksEnabled, spinnerEnabled, leaderboardEnabled]) {
      expect(fn(shop, qa, env)).toBe(true);
      expect(fn(shop, qa2, env)).toBe(true);
      expect(fn(shop, other, env)).toBe(false);
      expect(fn(shop, undefined, env)).toBe(false);
      expect(fn(shop, null, env)).toBe(false);
    }
  });
  it('"qa" with an empty list is off for everyone', () => {
    const env = { ...base, CARDBIT_QA_CUSTOMERS: "", CARDBIT_LEVELS: "qa" };
    expect(levelsEnabled(shop, qa, env)).toBe(false);
  });
  it("only applies to the Cardbit shop", () => {
    const env = { ...base, CARDBIT_LEVELS: "on" };
    expect(levelsEnabled("poke-collect.myshopify.com", qa, env)).toBe(false);
    expect(levelsEnabled(shop, qa, { ...env, CARDBIT_STOREFRONT_SHOP: "" })).toBe(false);
  });
  it("engagementFlags reports per viewer", () => {
    const env = { ...base, CARDBIT_SPINNER: "qa", CARDBIT_SPARKS: "on" };
    expect(engagementFlags(shop, qa, env)).toEqual({ spinner: true, leaderboard: false, sparks: true, subscriptions: false });
    expect(engagementFlags(shop, other, env)).toEqual({ spinner: false, leaderboard: false, sparks: true, subscriptions: false });
  });
  it("matches ids exactly by number", () => {
    expect(isQaCustomer("gid://shopify/Customer/111", base)).toBe(false);
    expect(isQaCustomer("22", base)).toBe(true);
  });
});
