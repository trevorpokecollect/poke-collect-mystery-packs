import { describe, expect, it } from "vitest";
import { openingStyle, sleeveAllowed, stylePicker, isRevealChoice, PASS_SLEEVES, REVEAL_FX } from "./pass-style";
import { ICONS } from "../../lib/cardbit-levels";

describe("Pack Pass opening style", () => {
  it("has a reveal effect for every character and 5 sleeves", () => {
    for (const i of ICONS) expect(REVEAL_FX[i.id], i.id).toBeTruthy();
    expect(PASS_SLEEVES.map((s) => s.id)).toEqual(["neon", "holo", "midnight", "circuit", "gold"]);
  });
  it("gates sleeves by tier (Plus gets none, Gold is Ultimate only)", () => {
    expect(sleeveAllowed("neon", null)).toBe(false);
    expect(sleeveAllowed("neon", "plus")).toBe(false);
    expect(sleeveAllowed("neon", "pro")).toBe(true);
    expect(sleeveAllowed("gold", "pro")).toBe(false);
    expect(sleeveAllowed("gold", "ultimate")).toBe(true);
    expect(sleeveAllowed("nope", "ultimate")).toBe(false);
  });
  it("accepts character ids and off as reveal choices", () => {
    expect(isRevealChoice("blazebit")).toBe(true);
    expect(isRevealChoice("off")).toBe(true);
    expect(isRevealChoice("pikachu")).toBe(false);
  });
  it("shows nothing once perks end, and drops the Gold sleeve below Ultimate", () => {
    const saved = { sleeveId: "gold", revealFx: "zappix", iconId: "latch" };
    expect(openingStyle(saved, "ultimate")).toEqual({ sleeve: "/site/img/pass/sleeves/gold.svg", reveal: { character: "zappix", ...REVEAL_FX.zappix } });
    expect(openingStyle(saved, "pro").sleeve).toBeNull();
    expect(openingStyle(saved, "pro").reveal?.character).toBe("zappix");
    expect(openingStyle(saved, "plus")).toEqual({ sleeve: null, reveal: null });
    expect(openingStyle(saved, null)).toEqual({ sleeve: null, reveal: null });
  });
  it("defaults the reveal effect to the icon's character (emotes too) and honors off", () => {
    expect(openingStyle({ iconId: "glitchog-love" }, "pro").reveal?.element).toBe("crystal");
    expect(openingStyle({ iconId: "mossbit" }, "pro").reveal?.element).toBe("grass");
    expect(openingStyle({ iconId: "mossbit", revealFx: "off" }, "pro").reveal).toBeNull();
    expect(openingStyle({ iconId: null }, "pro").reveal).toBeNull();
  });
  it("builds the Rewards picker", () => {
    const p = stylePicker({ sleeveId: "holo", revealFx: null, iconId: "wyrmware-hype" }, "pro");
    expect(p.unlocked).toBe(true);
    expect(p.sleeve).toBe("holo");
    expect(p.autoReveal).toBe("wyrmware");
    expect(p.sleeves.find((s) => s.id === "gold")?.unlocked).toBe(false);
    expect(p.characters).toHaveLength(12);
    expect(stylePicker(null, "plus").unlocked).toBe(false);
  });
});
